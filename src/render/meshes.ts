import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Entity } from "../sim/entity";
import type { SpeciesKind } from "../sim/types";
import type { Carrion, Plant, World } from "../sim/world";
import type { ReplayFrame } from "../observe/replay";
import type { EraConfig } from "../sim/era";

const HERB_COLOR = 0xd7f05a;
const CARN_COLOR = 0xc84f4f;

/** Gait wave speed in radians per second. */
export const GAIT_RATE = 11;
/** Frame-to-frame travel, in world units, at which an animal reads as moving.
 * Deliberately small: any real travel drives a full stride, so the amplitude
 * never changes with the tick speed the player picked, while a paused or
 * standing animal (zero travel) settles back into a still pose. */
export const GAIT_REFERENCE_TRAVEL = 0.4;
/** Peak deform as a fraction of the body's size. Kept modest: this is flavour,
 * not a cartoon — the animal must stay readable at god-camera distance. The
 * animals are only a handful of pixels across, so it still has to be big
 * enough to register as life rather than as noise. */
export const GAIT_SQUASH = 0.22;
/** Peak hop height as a fraction of the body's resting height, so a larger
 * (better fed) animal hops proportionally higher. */
export const GAIT_HOP = 0.45;
/** How fast the travel signal eases off once an animal stops. */
const GAIT_DECAY = 0.86;

/**
 * The stride's deform on its own, as factors around 1.
 *
 * `wave` is a sine in [-1, 1]. At +1 the body is at the top of its stride:
 * stretched tall and thin. At -1 it is grounded and squashed short and wide,
 * like the compression of a landing. The x/z axes are compensated by exactly
 * 1/sqrt against the y deform, so this squashes rather than resizes (volume is
 * preserved to floating-point).
 *
 * Kept separate from `gaitPose` because only the body is built to take it: the
 * pool inverts this for the rigid feature rig (snout, tail, ears, crest), so
 * they hold their own shape while the body strides under them.
 */
export interface StrideDeform {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

export function gaitDeform(gait: number, wave: number): StrideDeform {
    const y = 1 + GAIT_SQUASH * gait * wave; // positive = tall, negative = squat
    const x = 1 / Math.sqrt(y);
    return { x, y, z: x };
}

/**
 * Squash-stretch pose for one animal's body: its size times the stride's
 * deform. The hop is biased upward (0.5 + 0.5 * wave) so a footfall never
 * pushes the body below its resting height.
 */
export function gaitPose(baseScale: number, gait: number, wave: number) {
    const stride = gaitDeform(gait, wave);
    return {
        sx: baseScale * stride.x,
        sy: baseScale * stride.y,
        sz: baseScale * stride.z,
        lift: baseScale * GAIT_HOP * gait * (0.5 + 0.5 * wave),
    };
}

/**
 * Advance the smoothed 0..1 "this animal is travelling" signal. It rises to
 * the travel target immediately and eases back down, so a running animal
 * strides at once while a stopped (or paused) one settles into a still pose.
 */
export function nextGait(prev: number, travel: number): number {
    const target = Math.min(1, travel / GAIT_REFERENCE_TRAVEL);
    return target > prev ? target : prev * GAIT_DECAY;
}

/** Seconds a dead body takes to deflate into the carrion it leaves behind.
 * Short enough to stay out of the way, long enough to read as a collapse. */
export const DEATH_DURATION = 0.5;
/** Width and height of a freshly dead body, and of one about to vanish, as
 * fractions of the animal's living size. */
export const COLLAPSE_WIDTH = 0.55;
export const COLLAPSE_HEIGHT = 0.18;
/** A corpse's first drawn size (intact) and its size as it runs out of mass. */
export const CARRION_FRESH_SCALE = 0.92;
export const CARRION_GONE_SCALE = 0.12;

/**
 * Collapse pose for a body that has just died, as it deflates into its
 * carrion. `p` is 0..1 progress: the squash is an ease-out, so the body drops
 * fast and then settles instead of fading out linearly.
 */
export function collapsePose(baseScale: number, progress: number) {
    const clamped = Math.min(1, Math.max(0, progress));
    const eased = 1 - (1 - clamped) * (1 - clamped);
    return {
        width: baseScale * (1 - (1 - COLLAPSE_WIDTH) * eased),
        height: baseScale * (1 - (1 - COLLAPSE_HEIGHT) * eased),
    };
}

/**
 * Size of a corpse relative to the body it used to be. `remaining` is the
 * corpse's energy over the value it was first drawn with: it starts intact and
 * shrinks to almost nothing as the carrion decays, rather than holding its
 * size and then blinking out of existence.
 */
export function carrionPose(remaining: number) {
    const rem = Math.min(1, Math.max(0, remaining));
    const width = CARRION_GONE_SCALE + (CARRION_FRESH_SCALE - CARRION_GONE_SCALE) * rem;
    // Also flattens as it goes, so it reads as a corpse settling into the
    // ground rather than a ball being uniformly scaled down.
    return { width, height: width * (0.45 + 0.55 * rem) };
}

/** Size of a tuft with one bite left, as a fraction of a fresh one. */
const PLANT_GRAZED_SCALE = 0.55;

/**
 * Size of a tuft as it is grazed down. `remaining` is the energy standing in it
 * over a fresh tuft's, so a tuft loses a little height with every bite taken
 * and how much grass a patch still holds reads from the god camera without
 * clicking anything. It shrinks rather than vanishing: a tuft with a bite left
 * is still a tuft, and one that is finished leaves the world entirely — so a
 * small tuft always means a grazed one, never a half-eaten one that is about
 * to disappear.
 */
export function plantBiteScale(remaining: number): number {
    const ratio = Math.min(1, Math.max(0, remaining));
    return PLANT_GRAZED_SCALE + (1 - PLANT_GRAZED_SCALE) * ratio;
}

/** Seconds a corpse takes to be pulled into the animal eating it. */
export const FEED_DURATION = 0.28;
/** Energy a corpse can lose to decay within a single drawn frame. The sim
 * decays carrion at 0.05 energy/tick and the app never runs more than 60 ticks
 * per frame, so 3 is the worst case; 4 leaves headroom.
 *
 * This is what distinguishes the two ways a corpse leaves the world, and it is
 * causal rather than positional: carrion is only ever removed by being eaten
 * or by decaying to zero, so a corpse last drawn above this budget *must* have
 * been taken by a predator. Proximity could not decide it — at the default
 * speed a predator travels ~17 world units per drawn frame, so by the time the
 * renderer notices the missing corpse the eater is long gone. */
export const CARRION_DECAY_BUDGET = 4;
/** Fraction of its size a corpse shrinks to by the time it is swallowed. */
const FEED_REMAINDER = 0.1;

/**
 * Pose for a corpse being eaten. `progress` is 0..1 progress. Returns the eased
 * progress — used to pull the morsel toward the eater — and the shrinking
 * size. The ease-out makes the corpse get yanked in and then vanish.
 */
export function feedPose(fromWidth: number, fromHeight: number, progress: number) {
    const clamped = Math.min(1, Math.max(0, progress));
    const eased = 1 - (1 - clamped) * (1 - clamped);
    const scale = 1 - (1 - FEED_REMAINDER) * eased;
    return { width: fromWidth * scale, height: fromHeight * scale, eased };
}

/**
 * Why a corpse left the sim. Carrion is removed in exactly two ways — eaten by
 * a predator, or decayed to nothing — so the energy it was last drawn with
 * decides which, and no guesswork about who was standing nearby is needed.
 */
export function carrionExit(energyWhenLastSeen: number): "eaten" | "decayed" {
    return energyWhenLastSeen > CARRION_DECAY_BUDGET ? "eaten" : "decayed";
}

/** Where a corpse was last drawn, so a vanished one can still be animated. */
interface CarrionSpot {
    x: number;
    y: number;
    energy: number;
    width: number;
    height: number;
}

/** A corpse mesh kept on screen while a predator consumes it. */
interface FeedingMeal {
    startTime: number;
    x: number;
    y: number;
    fromWidth: number;
    fromHeight: number;
    /** The animal eating it, or null if it was never seen being eaten. */
    eaterId: number | null;
    mesh: THREE.Mesh;
}

/** A mesh kept on screen for a moment after its animal died, collapsing. */
interface CollapsingBody {
    startTime: number;
    x: number;
    y: number;
    angle: number;
    baseScale: number;
    mesh: THREE.Mesh;
    shadow: THREE.Mesh | null;
}

/** What the renderer should draw this frame: the live world or a replay frame. */
export interface RenderSubjects {
    entities: Entity[];
    plants: Plant[];
    carrions: Carrion[];
}

/**
 * Silhouette of a species, in world units: +z is the way the animal faces, so
 * the pool rotates it by pi/2 - angle to land that face on the sim's heading,
 * and +y is up.
 *
 * The two species used to share one sphere-plus-nose mesh and differ only in
 * colour, which does not survive the god camera. An animal is a handful of
 * pixels across at the default framing, the fog and the seasonal tint wash the
 * two hues toward each other, and a player watching a hundred of them cannot
 * tell a hunt from a graze. An outline does survive, because the eye reads
 * silhouette before detail at that size, so each species now gets its own body
 * proportions and its own features.
 *
 * `body` is the ellipsoid's radii. Both species deliberately keep the same
 * height (0.70): a single resting height in `poseAnimal` stands every animal on
 * the ground, and it can only be right for both if both bodies stand as tall.
 * Width and length are free to differ and carry the contrast — the herbivore is
 * wide, short and round, the carnivore narrow and long, so the two footprints
 * differ by roughly 2.7x in aspect. Features are the second read, visible when
 * the player zooms in: ears and a stub tail on the prey, a long snout, a
 * pointed tail and a dorsal spike on the hunter.
 */
export interface AnimalShape {
    /** Body ellipsoid radii: across (x), up (y), along the heading (z). */
    readonly body: readonly [number, number, number];
    /** Snout cone: base radius, where it starts, and where its tip lands on z. */
    readonly snout: { radius: number; base: number; reach: number };
    /** Rear taper, or null for a plain rump. */
    readonly tail: { radius: number; base: number; reach: number } | null;
    /** Ears perked up and out from the head, or null. */
    readonly ears: {
        radius: number;
        height: number;
        spread: number;
        back: number;
        tilt: number;
    } | null;
    /** One upright spike on the spine, or null. */
    readonly crest: { radius: number; height: number; back: number } | null;
}

export const ANIMAL_SHAPES: Record<SpeciesKind, AnimalShape> = {
    herbivore: {
        body: [0.8, 0.7, 0.62],
        snout: { radius: 0.3, base: 0.24, reach: 0.92 },
        tail: { radius: 0.15, base: -0.52, reach: -0.86 },
        ears: { radius: 0.16, height: 0.52, spread: 0.42, back: 0.2, tilt: 0.55 },
        crest: null,
    },
    carnivore: {
        body: [0.44, 0.7, 0.92],
        snout: { radius: 0.21, base: 0.58, reach: 1.36 },
        tail: { radius: 0.17, base: -0.76, reach: -1.34 },
        ears: null,
        crest: { radius: 0.15, height: 0.44, back: -0.12 },
    },
};

/** Full species colour for the body: vertex colours multiply the material. */
const BODY_TINT = new THREE.Color(1, 1, 1);
/** Head and tail are tinted down so the front and back read in flat light. */
const EXTREMITY_TINT = new THREE.Color().setRGB(0.62, 0.56, 0.52);
/** Milder tint on ears and crests: a shade, not a marking. */
const FEATURE_TINT = new THREE.Color().setRGB(0.88, 0.84, 0.8);
/** Roots and stems: darker than what grows out of them, so a tuft has structure. */
const STUMP_TINT = new THREE.Color().setRGB(0.62, 0.55, 0.47);
/** Bone: a corpse's ribs and limbs, shaded off its own slab. */
const BONE_TINT = new THREE.Color().setRGB(0.7, 0.64, 0.57);

/** Paint every vertex one flat colour, so one material can serve both species. */
function tinted(geometry: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
    const count = geometry.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let idx = 0; idx < count; idx++) {
        colors[idx * 3] = color.r;
        colors[idx * 3 + 1] = color.g;
        colors[idx * 3 + 2] = color.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geometry;
}

/** A cone lying along the heading, its apex landing on `reach` (both on z). */
function coneAlong(radius: number, base: number, reach: number, segments: number): THREE.BufferGeometry {
    const cone = new THREE.ConeGeometry(radius, Math.abs(reach - base), segments);
    // A cone's apex points along +Y: rotate it onto the heading, forwards or
    // backwards, then slide it so the apex lands exactly on `reach`.
    cone.rotateX(reach >= base ? Math.PI / 2 : -Math.PI / 2);
    cone.translate(0, 0, (base + reach) / 2);
    return cone;
}

/** Height of the body's surface above (x, z), where a feature stands. */
function surfaceHeight(shape: AnimalShape, x: number, z: number): number {
    const [bodyX, bodyY, bodyZ] = shape.body;
    const inner = 1 - (x / bodyX) ** 2 - (z / bodyZ) ** 2;
    return bodyY * Math.sqrt(Math.max(0, inner));
}

/** A point in an animal's own frame: +z is the way it faces, +y is up. */
export interface Anchor {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

/** The body alone: the ellipsoid that takes the stride's deform. */
function buildBody(shape: AnimalShape): THREE.BufferGeometry {
    const [bodyX, bodyY, bodyZ] = shape.body;
    const body = new THREE.SphereGeometry(1, 10, 8);
    body.scale(bodyX, bodyY, bodyZ);
    return tinted(body, BODY_TINT);
}

/**
 * Merge one species' features — snout, tail, ears, crest — in the pose they
 * are authored in, and report where they are planted on the body: the mean of
 * their attachment points at the highest they stand.
 *
 * The body and its features are separate geometries because they take separate
 * transforms: the stride squashes the body and must not squash these. They are
 * rigid as a set, and a rigid set has to pivot somewhere — pick a spot on the
 * body the features are planted on, and they keep their own shape while the
 * body carries them. The highest attachment is the one to pivot on, because a
 * feature lower than the pivot only ever sits a little deeper in the body as
 * the surface moves, which cannot be seen, while one higher would lift off it.
 * Averaging the points at that height keeps a symmetric pair (the ears) on the
 * body's axis, where the surface rises and falls the way both of them do.
 */
function buildFeatures(shape: AnimalShape): {
    geometry: THREE.BufferGeometry;
    anchor: Anchor;
} {
    const parts: THREE.BufferGeometry[] = [];
    /** Where each feature meets the body, in body units. */
    const planted: Anchor[] = [];

    parts.push(tinted(
        coneAlong(shape.snout.radius, shape.snout.base, shape.snout.reach, 6),
        EXTREMITY_TINT,
    ));
    // coneAlong stands the cone's base on the body's axis, at `base`.
    planted.push({ x: 0, y: 0, z: shape.snout.base });
    if (shape.tail) {
        parts.push(tinted(
            coneAlong(shape.tail.radius, shape.tail.base, shape.tail.reach, 5),
            EXTREMITY_TINT,
        ));
        planted.push({ x: 0, y: 0, z: shape.tail.base });
    }
    if (shape.ears) {
        const { radius, height, spread, back, tilt } = shape.ears;
        for (const side of [-1, 1]) {
            const ear = new THREE.ConeGeometry(radius, height, 5);
            ear.rotateZ(side * tilt); // lean outwards, so a pair reads as ears
            // Stand it on the body's surface: half of the cone rises above its
            // own base point, and leaning tilts that rise back by cos(tilt).
            const base = surfaceHeight(shape, side * spread, back);
            ear.translate(side * spread, base + (height / 2) * Math.cos(tilt), back);
            parts.push(tinted(ear, FEATURE_TINT));
            // Leaning is what moves the cone's base off the spot it was stood
            // on, out to the side its tip leans.
            planted.push({ x: side * (spread + (height / 2) * Math.sin(tilt)), y: base, z: back });
        }
    }
    if (shape.crest) {
        const { radius, height, back } = shape.crest;
        const crest = new THREE.ConeGeometry(radius, height, 5);
        const base = surfaceHeight(shape, 0, back);
        crest.translate(0, base + height / 2, back);
        parts.push(tinted(crest, FEATURE_TINT));
        planted.push({ x: 0, y: base, z: back });
    }

    const top = Math.max(...planted.map((point) => point.y));
    const highest = planted.filter((point) => point.y === top);
    const mean = (ofProperty: (point: Anchor) => number) =>
        highest.reduce((sum, point) => sum + ofProperty(point), 0) / highest.length;
    const merged = mergeGeometries(parts, false);
    if (!merged) {
        throw new Error("Failed to merge animal features");
    }
    return {
        geometry: merged,
        anchor: { x: mean((point) => point.x), y: top, z: mean((point) => point.z) },
    };
}

/**
 * One species' geometry, split so the body can stride without distorting the
 * features. `appendages` is re-centred on `anchor`, so the pool can place the
 * rigid rig at that point and let the body's deform carry it.
 */
export interface AnimalParts {
    readonly body: THREE.BufferGeometry;
    readonly appendages: THREE.BufferGeometry;
    readonly anchor: Anchor;
}

/**
 * One species' body and features as a rest pose, merged into a single
 * vertex-tinted geometry. Exported because the shapes are a visual claim: the
 * tests check them as geometry rather than trusting the spec to have been read
 * correctly.
 */
export function buildAnimalGeometry(shape: AnimalShape): THREE.BufferGeometry {
    // One merged geometry per species drawn with one material: no groups.
    const merged = mergeGeometries([buildBody(shape), buildFeatures(shape).geometry], false);
    if (!merged) {
        throw new Error("Failed to merge animal geometry");
    }
    return merged;
}

/**
 * One species' geometry, split the way the pool draws it: a deformable body
 * and a rigid set of features. Exported for the same reason as the merged
 * form — the split is a claim about how the animal moves, and the tests
 * measure it.
 */
export function buildAnimalParts(shape: AnimalShape): AnimalParts {
    const { geometry, anchor } = buildFeatures(shape);
    return {
        body: buildBody(shape),
        appendages: geometry.clone().translate(-anchor.x, -anchor.y, -anchor.z),
        anchor,
    };
}

/** Exactly two of each animal geometry are ever built, so they are cached. */
const ANIMAL_GEOMETRIES = new Map<SpeciesKind, THREE.BufferGeometry>();
const ANIMAL_PARTS = new Map<SpeciesKind, AnimalParts>();

/** The rest-pose geometry drawn for a species kind, built on first use. */
export function animalGeometry(kind: SpeciesKind): THREE.BufferGeometry {
    let geometry = ANIMAL_GEOMETRIES.get(kind);
    if (!geometry) {
        geometry = buildAnimalGeometry(ANIMAL_SHAPES[kind]);
        ANIMAL_GEOMETRIES.set(kind, geometry);
    }
    return geometry;
}

/** The body and rigid features drawn for a species kind, built on first use. */
export function animalParts(kind: SpeciesKind): AnimalParts {
    let parts = ANIMAL_PARTS.get(kind);
    if (!parts) {
        parts = buildAnimalParts(ANIMAL_SHAPES[kind]);
        ANIMAL_PARTS.set(kind, parts);
    }
    return parts;
}

/**
 * Shape of the vegetation tuft, in world units, standing on y = 0: a short
 * stump with a few blades leaning out of it.
 */
export interface PlantShape {
    /** Blades fanned around the stump. */
    readonly blades: number;
    readonly bladeRadius: number;
    readonly bladeHeight: number;
    /** Radians each blade leans away from vertical. */
    readonly bladeLean: number;
    readonly stumpRadius: number;
    readonly stumpHeight: number;
}

export const PLANT_SHAPE: PlantShape = {
    blades: 4,
    bladeRadius: 0.2,
    bladeHeight: 1.05,
    bladeLean: 0.4,
    stumpRadius: 0.2,
    stumpHeight: 0.26,
};

/**
 * Merge a stump and its blades into one vertex-tinted geometry.
 *
 * The blades are the point. A cone or a cylinder is a solid lump from the god
 * camera — the same lump a grazing animal is — while separate blades leave gaps
 * in the outline, and gaps are something only vegetation has. The tuft also
 * ends up taller than it is wide, which is the opposite of a corpse and only
 * half-way to an animal.
 *
 * Exported because the shape is a visual claim: the tests measure it as
 * geometry rather than trusting this comment.
 */
export function buildPlantGeometry(shape: PlantShape = PLANT_SHAPE): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    const stump = new THREE.CylinderGeometry(
        shape.stumpRadius * 0.7,
        shape.stumpRadius,
        shape.stumpHeight,
        5,
    );
    stump.translate(0, shape.stumpHeight / 2, 0);
    parts.push(tinted(stump, STUMP_TINT));

    for (let blade = 0; blade < shape.blades; blade++) {
        const cone = new THREE.ConeGeometry(shape.bladeRadius, shape.bladeHeight, 4);
        // Stand the blade on its own base, lean it out of the stump, then fan it
        // round: every blade leaves the centre, so the tips make a star instead
        // of a dome.
        cone.translate(0, shape.bladeHeight / 2, 0);
        cone.rotateZ(shape.bladeLean);
        cone.rotateY((blade / shape.blades) * Math.PI * 2);
        cone.translate(0, shape.stumpHeight * 0.6, 0);
        parts.push(tinted(cone, BODY_TINT));
    }
    const merged = mergeGeometries(parts, false);
    if (!merged) {
        throw new Error("Failed to merge plant geometry");
    }
    return merged;
}

/**
 * Shape of a corpse, in world units, resting on y = 0: a flattened faceted
 * slab with a ridged spine and its limbs splayed out sideways.
 */
export interface CarrionShape {
    /** Slab radii: across (x), up (y), along (z). */
    readonly slab: readonly [number, number, number];
    /** Radial segments of the slab. Few of them, so the outline is faceted. */
    readonly slabFacets: number;
    /** Spikes along the spine, leaning alternately out of it. */
    readonly ribs: {
        readonly count: number;
        readonly radius: number;
        readonly height: number;
        readonly lean: number;
        readonly span: number;
    };
    /** Limbs lying out to the sides, which is what widens the footprint. */
    readonly limbs: {
        readonly radius: number;
        readonly length: number;
        readonly spread: number;
        readonly back: number;
        /** Radians the limb rises off the ground over its length. */
        readonly lift: number;
        readonly yaw: number;
    };
}

export const CARRION_SHAPE: CarrionShape = {
    slab: [0.55, 0.15, 0.38],
    slabFacets: 7,
    ribs: { count: 3, radius: 0.075, height: 0.34, lean: 0.5, span: 0.4 },
    limbs: { radius: 0.075, length: 0.58, spread: 0.24, back: -0.2, lift: 0.2, yaw: 0.35 },
};

/**
 * Merge a corpse's slab, ribs and limbs into one vertex-tinted geometry.
 *
 * A corpse used to be a plain sphere, which is exactly the wrong shape: a
 * living animal is a sphere too, so at the default framing a kill and a body
 * standing over it differed only in hue — and hue is what the fog and the
 * seasonal tint take away first. This is flat (a little over a third of the
 * living height), faceted rather than round, and jagged at the edges, so a
 * corpse reads as a body lying down from the outline alone.
 *
 * Exported for the same reason as the plant: the tests measure the claim.
 */
export function buildCarrionGeometry(shape: CarrionShape = CARRION_SHAPE): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    const [slabX, slabY, slabZ] = shape.slab;
    const slab = new THREE.SphereGeometry(1, shape.slabFacets, 3);
    slab.scale(slabX, slabY, slabZ);
    slab.translate(0, slabY, 0); // resting on the ground, not sunk into it
    parts.push(tinted(slab, BODY_TINT));

    const { count, radius, height, lean, span } = shape.ribs;
    for (let rib = 0; rib < count; rib++) {
        const along = count === 1 ? 0 : rib / (count - 1) - 0.5;
        const spike = new THREE.ConeGeometry(radius, height, 4);
        spike.translate(0, height / 2, 0);
        spike.rotateZ((rib % 2 === 0 ? 1 : -1) * lean);
        spike.translate(0, slabY, along * span);
        parts.push(tinted(spike, BONE_TINT));
    }

    const { radius: limbRadius, length, spread, back, lift, yaw } = shape.limbs;
    for (const side of [-1, 1]) {
        const limb = new THREE.ConeGeometry(limbRadius, length, 4);
        limb.translate(0, length / 2, 0);
        // Lay the limb down pointing out to the side, lifted just enough that
        // its tip clears the ground, then swing it back from the shoulder.
        limb.rotateZ(-side * (Math.PI / 2 - lift));
        limb.rotateY(side * yaw);
        limb.translate(side * spread, limbRadius, back);
        parts.push(tinted(limb, BONE_TINT));
    }
    const merged = mergeGeometries(parts, false);
    if (!merged) {
        throw new Error("Failed to merge carrion geometry");
    }
    return merged;
}

/**
 * How close a click has to land to a tuft to count as clicking it, in NDC —
 * about 2% of the viewport. Only plants get this forgiveness: a tuft is a few
 * pixels of thin blades, an animal is not.
 */
const PICK_SLOP_NDC = 0.03;
/** The selection ring is drawn for an animal's width; a tuft is smaller. */
const PLANT_RING_SCALE = 0.7;

/** Keeps a Three.js mesh per sim entity/plant/carrion id, reusing meshes across frames. */
export class MeshPool {
    /** Update plant colors for a new era. Called when the player switches
     * era mid-run or restarts with a different era. */
    setEra(era?: EraConfig): void {
        this.plantPeakColor = new THREE.Color(era?.plantPeakColor ?? 0x3fae5a);
        this.plantTroughColor = new THREE.Color(era?.plantTroughColor ?? 0x9a7b4d);
        this.syncSeason(null);
    }
    private readonly scene: THREE.Scene;
    private readonly npcMeshes = new Map<number, THREE.Mesh>();
    private readonly npcShadows = new Map<number, THREE.Mesh>();
    private readonly plantMeshes = new Map<number, THREE.Mesh>();
    private readonly carrionMeshes = new Map<number, THREE.Mesh>();
    private readonly shadowMat: THREE.MeshBasicMaterial;
    private plantPeakColor = new THREE.Color(0x3fae5a);
    private plantTroughColor = new THREE.Color(0x9a7b4d);
    /**
     * Plants and corpses get their own silhouettes for the reason the animals
     * do: at the default framing each is a few pixels across, the fog and the
     * seasonal tint pull every hue toward every other, and the player has to
     * tell a grazing animal from a plant from a body on the ground at a glance.
     * Outline survives that, colour does not.
     *
     * Both are built standing on the ground plane (y = 0) at their own origin,
     * so the pool can place them with a plain position, a plant grows upwards
     * as the season swells it, and a corpse's base stays on the floor at every
     * stage of its decay.
     */
    private readonly plantGeometry = buildPlantGeometry(PLANT_SHAPE);
    private readonly carrionGeometry = buildCarrionGeometry(CARRION_SHAPE);
    private readonly plantMaterial = new THREE.MeshLambertMaterial({
        color: 0x3fae5a,
        vertexColors: true,
    });
    private readonly carrionMaterial = new THREE.MeshLambertMaterial({
        color: 0x8a7a5c,
        vertexColors: true,
    });
    private plantSeasonScale = 1;
    /** Energy in a fresh tuft, so a grazed one can be drawn in proportion. Set
     * from the live world, and reused for replay frames of that same run: a
     * frame carries each plant's energy but not the ceiling it was cut from. */
    private plantFullEnergy = 1;
    /** Seconds of wall clock driving the gait wave; refreshed by each sync. */
    private animTime = 0;
    /** Last drawn position per animal, used to measure travel between frames. */
    private readonly lastPos = new Map<number, { x: number; y: number }>();
    /** Smoothed travel signal per animal that gates the gait animation. */
    private readonly gait = new Map<number, number>();
    /** Bodies whose animal is gone but whose mesh is still collapsing. */
    private readonly collapsing = new Map<number, CollapsingBody>();
    /** Energy each corpse was first drawn with, its reference "intact" mass. */
    private readonly carrionPeak = new Map<number, number>();
    /** Corpses drawn this frame, keyed by id. Swapped with carrionPrev each
     * frame so a corpse that left the sim can still be animated from where it
     * was last seen. */
    private carrionSeen = new Map<number, CarrionSpot>();
    private carrionPrev = new Map<number, CarrionSpot>();
    /** Corpses currently being pulled into the animal that ate them. */
    private readonly feeding = new Map<number, FeedingMeal>();
    private readonly materials = new Map<number, THREE.MeshLambertMaterial>();
    /** Flat list of animal meshes with ids, rebuilt each sync, for click picking. */
    private pickList: Array<{ id: number; mesh: THREE.Mesh }> = [];
    private readonly ring: THREE.Mesh;
    private selectedId: number | null = null;
    /** Pulsing red ring above a starving carnivore's head. */
    private readonly cannibalIndicators = new Map<number, THREE.Mesh>();
    private cannibalThreshold = 0;

    constructor(scene: THREE.Scene, era?: EraConfig) {
        this.scene = scene;
        this.plantPeakColor = new THREE.Color(era?.plantPeakColor ?? 0x3fae5a);
        this.plantTroughColor = new THREE.Color(era?.plantTroughColor ?? 0x9a7b4d);
        this.plantMaterial.color.copy(this.plantPeakColor);
        const ringGeo = new THREE.RingGeometry(1.1, 1.45, 24);
        this.ring = new THREE.Mesh(
            ringGeo,
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
        );
        this.ring.rotation.x = -Math.PI / 2;
        this.ring.visible = false;
        scene.add(this.ring);

        this.shadowMat = new THREE.MeshBasicMaterial({
            color: 0x1a1a1a,
            transparent: true,
            opacity: 0.32,
            depthWrite: false,
        });
    }

    private materialFor(color: number, vertexColors = false): THREE.MeshLambertMaterial {
        const key = vertexColors ? color | 0x10000000 : color;
        let material = this.materials.get(key);
        if (!material) {
            material = new THREE.MeshLambertMaterial({ color, vertexColors });
            this.materials.set(key, material);
        }
        return material;
    }

    /** Drop every mesh (used when a new World replaces the old one). */
    reset(): void {
        for (const mesh of this.npcMeshes.values()) this.scene.remove(mesh);
        for (const mesh of this.plantMeshes.values()) this.scene.remove(mesh);
        for (const mesh of this.carrionMeshes.values()) this.scene.remove(mesh);
        // A dying body belongs to the world being thrown away: drop it now
        // rather than letting it collapse on top of the new run.
        for (const body of this.collapsing.values()) {
            this.scene.remove(body.mesh);
            if (body.shadow) this.scene.remove(body.shadow);
        }
        for (const shadow of this.npcShadows.values()) this.scene.remove(shadow);
        for (const meal of this.feeding.values()) this.scene.remove(meal.mesh);
        for (const indicator of this.cannibalIndicators.values()) this.scene.remove(indicator);
        this.npcMeshes.clear();
        this.npcShadows.clear();
        this.plantMeshes.clear();
        this.carrionMeshes.clear();
        // Corpse ids restart with the new world, so stale reference masses
        // would otherwise describe the wrong bodies.
        this.carrionPeak.clear();
        this.carrionSeen.clear();
        this.carrionPrev.clear();
        this.feeding.clear();
        this.collapsing.clear();
        this.cannibalIndicators.clear();
        this.lastPos.clear();
        this.gait.clear();
        this.pickList = [];
        this.ring.visible = false;
        this.selectedId = null;
    }

    private reap(pool: Map<number, THREE.Mesh>, seen: Set<number>): void {
        for (const [id, mesh] of pool) {
            if (seen.has(id)) continue;
            this.scene.remove(mesh);
            pool.delete(id);
        }
    }

    /** Draw the live world. `animTime` is wall-clock seconds; omitting it
     * holds the gait clock still (a frozen pose). */
    sync(
        world: World,
        selectedId: number | null = null,
        animTime = this.animTime,
    ): void {
        this.animTime = animTime;
        this.cannibalThreshold = world.config.cannibalismThreshold ?? 0;
        this.plantFullEnergy = world.plantParams.energy;
        const seasonal = (world.config.plantSeasonLength ?? 0) > 0;
        this.syncSeason(seasonal ? world.seasonAbundance : null);
        this.syncCollapsing();
        this.syncFeeding();
        this.syncSubjects({ entities: world.entities, plants: world.plants, carrions: world.carrions }, selectedId);
    }

    /** Draw either the live world's collections or a replay frame's decoding of them. */
    syncSubjects(
        subjects: RenderSubjects,
        selectedId: number | null = null,
    ): void {
        this.selectedId = selectedId;
        this.syncNpcs(subjects.entities);
        this.syncPlants(subjects.plants);
        this.syncCarrions(subjects.carrions);
        this.retireMissingCarrions(
            subjects.entities
                .filter((e) => e.alive && e.species.kind === "carnivore")
                .map((e) => ({ id: e.id, x: e.pos.x, y: e.pos.y })),
        );
    }

    /** Draw a recorded replay frame instead of the live world. */
    syncFrame(
        frame: ReplayFrame,
        selectedId: number | null = null,
        animTime = this.animTime,
    ): void {
        this.animTime = animTime;
        this.selectedId = selectedId;
        this.syncCollapsing();
        this.syncFeeding();
        // Replays carry their own season position: plants tint and size with
        // the historical tick (null means seasons were off — neutral look).
        this.syncSeason(frame.seasonAbundance);
        const npcLike = frame.entities.map((row) => ({
            id: row[0],
            kind: row[1],
            x: row[2],
            y: row[3],
            angle: row[4],
            energy01: row[5],
        }));
        this.syncNpcsFrame(npcLike);
        this.syncPlantsFrame(frame.plants);
        this.syncCarrionsFrame(frame.carrions);
        this.retireMissingCarrions(
            npcLike.filter((n) => n.kind === 1).map((n) => ({ id: n.id, x: n.x, y: n.y })),
        );
    }

    // ------------------------------------------------------------------
    // Season & live-object syncs
    // ------------------------------------------------------------------

    /** Shift the whole biome with the season: lush at the peak, dry at the trough. */
    private syncSeason(abundance: number | null): void {
        if (abundance === null) {
            this.plantMaterial.color.copy(this.plantPeakColor);
            this.plantSeasonScale = 1;
            return;
        }
        this.plantMaterial.color.copy(this.plantTroughColor).lerp(this.plantPeakColor, abundance);
        this.plantSeasonScale = 0.7 + 0.6 * abundance;
    }

    private syncNpcs(entities: Entity[]): void {
        const seenNpc = new Set<number>();
        this.pickList = [];
        for (const e of entities) {
            if (!e.alive) continue;
            seenNpc.add(e.id);
            let mesh = this.npcMeshes.get(e.id);
            if (!mesh) {
                // The silhouette follows the species, not the colour alone.
                mesh = this.addAnimal(e.id, e.species.kind, this.materialFor(e.species.color, true));
            }
            const scale = 0.6 + 0.8 * Math.min(1, e.energy / e.species.maxEnergy);
            const lift = this.poseAnimal(mesh, e.id, e.pos.x, e.pos.y, e.angle, scale);
            this.pickList.push({ id: e.id, mesh });

            let shadow = this.npcShadows.get(e.id);
            if (!shadow) {
                // Each shadow owns its material: opacity is animated per animal
                // (energy and hop height), which a shared material would smear
                // into "whatever the last animal set".
                shadow = this.makeShadow();
                this.scene.add(shadow);
                this.npcShadows.set(e.id, shadow);
            }
            // The shadow tightens and fades as the body hops clear of it.
            const airborne = lift;
            shadow.scale.setScalar(scale * 0.9 * (1 - 0.3 * airborne));
            shadow.position.set(e.pos.x, 0.02, e.pos.y);
            (shadow.material as THREE.MeshBasicMaterial).opacity =
                (0.22 + 0.14 * Math.min(1, e.energy / e.species.maxEnergy)) * (1 - 0.3 * airborne);

            this.updateCannibalIndicator(e, mesh);
        }
        this.pruneNpcs(seenNpc, true);
        this.reap(this.npcShadows, seenNpc);
        this.reap(this.cannibalIndicators, seenNpc);
        this.updateRing();
    }
    private updateCannibalIndicator(entity: Entity, entityMesh: THREE.Mesh): void {
        const isStarvingCarnivore =
            this.cannibalThreshold > 0 &&
            entity.species.kind === "carnivore" &&
            entity.energy < this.cannibalThreshold * entity.species.maxEnergy;

        if (!isStarvingCarnivore) {
            const indicator = this.cannibalIndicators.get(entity.id);
            if (indicator) {
                indicator.visible = false;
            }
            return;
        }

        let indicator = this.cannibalIndicators.get(entity.id);
        if (!indicator) {
            indicator = new THREE.Mesh(
                new THREE.RingGeometry(0.55, 0.75, 20),
                new THREE.MeshBasicMaterial({
                    color: 0xff3333,
                    transparent: true,
                    opacity: 0.7,
                    side: THREE.DoubleSide,
                    depthWrite: false,
                }),
            );
            indicator.rotation.x = -Math.PI / 2;
            this.scene.add(indicator);
            this.cannibalIndicators.set(entity.id, indicator);
        }
        indicator.visible = true;
        indicator.position.set(entity.pos.x, entityMesh.position.y + 0.9, entity.pos.y);
        const pulse = 0.35 + 0.35 * Math.sin(this.animTime * 6 + entity.id * 2.3);
        (indicator.material as THREE.MeshBasicMaterial).opacity = pulse;
    }

    private syncNpcsFrame(
        npcs: Array<{ id: number; kind: number; x: number; y: number; angle: number; energy01: number }>,
    ): void {
        const seenNpc = new Set<number>();
        this.pickList = [];
        for (const n of npcs) {
            seenNpc.add(n.id);
            let mesh = this.npcMeshes.get(n.id);
            if (!mesh) {
                // Replay rows carry the species as a number (0 herbivore,
                // 1 carnivore). The silhouette is chosen the same way the live
                // world chooses it, so a replay shows the same animals.
                const kind: SpeciesKind = n.kind === 0 ? "herbivore" : "carnivore";
                const color = kind === "herbivore" ? HERB_COLOR : CARN_COLOR;
                mesh = this.addAnimal(n.id, kind, this.materialFor(color, true));
            }
            const scale = 0.6 + 0.8 * n.energy01;
            const lift = this.poseAnimal(mesh, n.id, n.x, n.y, n.angle, scale);
            this.pickList.push({ id: n.id, mesh });

            let shadow = this.npcShadows.get(n.id);
            if (!shadow) {
                shadow = this.makeShadow();
                this.scene.add(shadow);
                this.npcShadows.set(n.id, shadow);
            }
            const airborne = lift;
            shadow.scale.setScalar(scale * 0.9 * (1 - 0.3 * airborne));
            shadow.position.set(n.x, 0.02, n.y);
            (shadow.material as THREE.MeshBasicMaterial).opacity =
                (0.22 + 0.14 * n.energy01) * (1 - 0.3 * airborne);
        }
        this.pruneNpcs(seenNpc, false);
        this.reap(this.npcShadows, seenNpc);
        this.updateRing();
    }

    /**
     * Drop meshes whose animal is no longer in the sim. With `animateDeaths`
     * (live play) the body is handed to syncCollapsing instead of vanishing,
     * so a death reads as a collapse into the carrion it left behind. Replay
     * scrub keeps the abrupt removal: entities blink in and out as the frame
     * changes, and replaying a collapse for each one would just churn.
     */
    private pruneNpcs(seen: Set<number>, animateDeaths: boolean): void {
        for (const [id, mesh] of this.npcMeshes) {
            if (seen.has(id)) continue;
            this.lastPos.delete(id);
            this.gait.delete(id);
            if (animateDeaths && !this.collapsing.has(id)) {
                const shadow = this.npcShadows.get(id) ?? null;
                if (shadow) this.npcShadows.delete(id);
                // A dying animal is one rigid thing again: let the rig take the
                // body's collapse rather than holding whatever stride it was
                // caught mid-way through.
                MeshPool.rigOf(mesh)?.scale.set(1, 1, 1);
                this.collapsing.set(id, {
                    startTime: this.animTime,
                    x: mesh.position.x,
                    y: mesh.position.z,
                    angle: mesh.rotation.y,
                    baseScale: mesh.scale.y,
                    mesh,
                    shadow,
                });
                this.npcMeshes.delete(id);
                continue;
            }
            this.scene.remove(mesh);
            this.npcMeshes.delete(id);
        }
    }

    /** Deflate each just-dead body, then drop it once it has settled. */
    private syncCollapsing(): void {
        for (const [id, body] of this.collapsing) {
            const progress = (this.animTime - body.startTime) / DEATH_DURATION;
            if (progress >= 1) {
                this.scene.remove(body.mesh);
                if (body.shadow) this.scene.remove(body.shadow);
                this.collapsing.delete(id);
                continue;
            }
            const pose = collapsePose(body.baseScale, progress);
            body.mesh.scale.set(pose.width, pose.height, pose.width);
            // The body rests on its radius, so it sinks with the squash.
            body.mesh.position.set(body.x, pose.height * 0.6, body.y);
            if (body.shadow) {
                body.shadow.scale.setScalar(pose.width * 0.9);
                (body.shadow.material as THREE.MeshBasicMaterial).opacity = 0.32 * (1 - progress);
            }
        }
    }

    /**
     * Add one animal to the scene: its deformable body, with its rigid feature
     * rig parented to it at the point the features are planted on. The rig
     * takes its size from the body's own deform each frame, so nothing has to
     * be told the stride except the body itself.
     */
    private addAnimal(id: number, kind: SpeciesKind, material: THREE.MeshLambertMaterial): THREE.Mesh {
        const parts = animalParts(kind);
        const mesh = new THREE.Mesh(parts.body, material);
        const rig = new THREE.Mesh(parts.appendages, material);
        rig.name = "animalRig";
        rig.position.set(parts.anchor.x, parts.anchor.y, parts.anchor.z);
        mesh.add(rig);
        this.scene.add(mesh);
        this.npcMeshes.set(id, mesh);
        return mesh;
    }

    /** The rigid feature rig parented to an animal's body, if it has one. */
    private static rigOf(mesh: THREE.Mesh): THREE.Mesh | null {
        const rig = mesh.children.find((child) => child.name === "animalRig");
        return rig instanceof THREE.Mesh ? rig : null;
    }

    /**
     * Pose one animal for this frame: measure how far it travelled since the
     * last sync, then apply a squash-stretch stride with a small hop. Bodies
     * bob out of phase (seeded by id) so a herd never marches in lockstep, and
     * a standing or paused animal (no travel) settles into a clean pose.
     * Returns the normalized airborne height (0..1) so the caller can shrink
     * the shadow as the body rises.
     */
    private poseAnimal(
        mesh: THREE.Mesh,
        id: number,
        x: number,
        y: number,
        angle: number,
        baseScale: number,
    ): number {
        const last = this.lastPos.get(id);
        this.lastPos.set(id, { x, y });
        const travel = last ? Math.hypot(x - last.x, y - last.y) : 0;
        const gait = nextGait(this.gait.get(id) ?? 0, travel);
        this.gait.set(id, gait);
        const wave = Math.sin(this.animTime * GAIT_RATE + id * 1.7);
        const pose = gaitPose(baseScale, gait, wave);
        mesh.scale.set(pose.sx, pose.sy, pose.sz);
        // The sphere rests on its radius, so the standing height tracks the
        // current y squash before the hop is added on top.
        mesh.position.set(x, pose.sy * 0.6 + pose.lift, y);
        // Heading. The animal's snout is its own +Z, but a rotation about Y
        // turns +Z toward +X, while the sim heads along (cos angle, sin angle)
        // in (x, y) = scene (x, z). The two are reflections of each other, so
        // the rotation that lands the snout on the heading is pi/2 - angle.
        // Setting it to `angle` pointed every animal 90 degrees off except on
        // the diagonals, where the reflection happens to be a fixed point.
        mesh.rotation.y = Math.PI / 2 - angle;
        // The features are rigid: the rig's scale is exactly the inverse of the
        // stride the body above it was just given, so the snout keeps its
        // length and the ears their height while the body breathes. It needs no
        // placement of its own — its origin sits at the point the features are
        // planted on, and the body's deform carries that point where the
        // deformed surface goes.
        const rig = MeshPool.rigOf(mesh);
        if (rig) {
            const stride = gaitDeform(gait, wave);
            rig.scale.set(1 / stride.x, 1 / stride.y, 1 / stride.z);
        }
        // Normalized 0..1 lift, so callers don't have to know the body size.
        return pose.lift / (baseScale * GAIT_HOP);
    }
    private syncPlants(plants: Plant[]): void {
        const seenPlant = new Set<number>();
        for (const p of plants) {
            if (!p.alive) continue;
            seenPlant.add(p.id);
            let mesh = this.plantMeshes.get(p.id);
            if (!mesh) {
                mesh = new THREE.Mesh(this.plantGeometry, this.plantMaterial);
                this.scene.add(mesh);
                this.plantMeshes.set(p.id, mesh);
            }
            // Scaled about the ground, so a lush season makes the tuft taller
            // instead of lifting its base out of the soil — and so a tuft that
            // has been grazed down a bite or two shows it unasked.
            mesh.scale.setScalar(
                this.plantSeasonScale * plantBiteScale(p.energy / this.plantFullEnergy),
            );
            mesh.position.set(p.x, 0, p.y);
            // Tufts are pickable: a selected one can be asked how many bites it
            // has left (see the inspector).
            this.pickList.push({ id: p.id, mesh });
        }
        this.reap(this.plantMeshes, seenPlant);
    }

    private syncPlantsFrame(rows: number[][]): void {
        const seen = new Set<number>();
        for (const row of rows) {
            const id = row[0];
            seen.add(id);
            let mesh = this.plantMeshes.get(id);
            if (!mesh) {
                mesh = new THREE.Mesh(this.plantGeometry, this.plantMaterial);
                this.scene.add(mesh);
                this.plantMeshes.set(id, mesh);
            }
            // A frame records each tuft's remaining energy, so a replay shows
            // the same grazed-down sizes the live world did.
            const remaining = (row[3] ?? this.plantFullEnergy) / this.plantFullEnergy;
            mesh.scale.setScalar(this.plantSeasonScale * plantBiteScale(remaining));
            mesh.position.set(row[1], 0, row[2]);
            this.pickList.push({ id, mesh });
        }
        this.reap(this.plantMeshes, seen);
    }

    /** A fresh shadow disc. Each owns a material because opacity is animated
     * per animal (by energy and hop height); a shared material would smear
     * that into "whatever the last animal set". */
    private makeShadow(): THREE.Mesh {
        const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 12), this.shadowMat.clone());
        shadow.rotation.x = -Math.PI / 2;
        return shadow;
    }

    /**
     * Pose a corpse by how much mass it has left. The sim stores only the
     * current energy and a corpse only ever loses it, so the first value drawn
     * for an id is its intact mass — no extra sim field is needed to show the
     * body deflating away instead of holding its size and blinking out.
     */
    private poseCarrion(mesh: THREE.Mesh, id: number, x: number, y: number, energy: number): void {
        const peak = this.carrionPeak.get(id) ?? energy;
        this.carrionPeak.set(id, peak);
        const pose = carrionPose(peak > 0 ? energy / peak : 0);
        mesh.scale.set(pose.width, pose.height, pose.width);
        // The geometry rests on y = 0, so the corpse lies on the ground however
        // flat the pose squashes it rather than hovering or sinking.
        mesh.position.set(x, 0, y);
        this.carrionSeen.set(id, { x, y, energy, width: pose.width, height: pose.height });
    }

    private syncCarrions(carrions: Carrion[]): void {
        this.carrionSeen.clear();
        for (const c of carrions) {
            if (!c.alive) continue;
            let mesh = this.carrionMeshes.get(c.id);
            if (!mesh) {
                mesh = new THREE.Mesh(this.carrionGeometry, this.carrionMaterial);
                this.scene.add(mesh);
                this.carrionMeshes.set(c.id, mesh);
            }
            this.poseCarrion(mesh, c.id, c.x, c.y, c.energy);
        }
    }

    private syncCarrionsFrame(rows: number[][]): void {
        this.carrionSeen.clear();
        for (const row of rows) {
            const id = row[0];
            let mesh = this.carrionMeshes.get(id);
            if (!mesh) {
                mesh = new THREE.Mesh(this.carrionGeometry, this.carrionMaterial);
                this.scene.add(mesh);
                this.carrionMeshes.set(id, mesh);
            }
            this.poseCarrion(mesh, id, row[1], row[2], row[3]);
        }
    }

    /**
     * A corpse that left the sim between frames must not simply blink out. One
     * taken while it still had mass was eaten: keep the mesh and hand it to
     * syncFeeding to be pulled into the predator. One that ran out of mass just
     * finished decaying, and it has already deflated to nearly nothing, so it
     * can go.
     */
    private retireMissingCarrions(carnivores: ReadonlyArray<{ id: number; x: number; y: number }>): void {
        for (const [id, spot] of this.carrionPrev) {
            if (this.carrionSeen.has(id)) continue;
            const mesh = this.carrionMeshes.get(id);
            this.carrionMeshes.delete(id);
            this.carrionPeak.delete(id);
            if (!mesh) continue;
            if (carrionExit(spot.energy) === "decayed") {
                this.scene.remove(mesh);
                continue;
            }
            // Eaten. The corpse itself tells us so; aim the morsel at whichever
            // predator is nearest where it lay, which is the eater unless the
            // kill and a passing predator happened to coincide.
            let eaterId: number | null = null;
            let bestDistSq = Infinity;
            for (const predator of carnivores) {
                const distSq = (predator.x - spot.x) ** 2 + (predator.y - spot.y) ** 2;
                if (distSq <= bestDistSq) {
                    bestDistSq = distSq;
                    eaterId = predator.id;
                }
            }
            this.feeding.set(id, {
                startTime: this.animTime,
                x: spot.x,
                y: spot.y,
                fromWidth: spot.width,
                fromHeight: spot.height,
                eaterId,
                mesh,
            });
        }
        // Swap buffers in place instead of copying every frame.
        const stale = this.carrionPrev;
        this.carrionPrev = this.carrionSeen;
        this.carrionSeen = stale;
    }

    /** Pull each consumed corpse into the animal eating it, then drop it. The
     * target is looked up live, so the morsel follows a moving predator. */
    private syncFeeding(): void {
        for (const [id, meal] of this.feeding) {
            const progress = (this.animTime - meal.startTime) / FEED_DURATION;
            if (progress >= 1) {
                this.scene.remove(meal.mesh);
                this.feeding.delete(id);
                continue;
            }
            const pose = feedPose(meal.fromWidth, meal.fromHeight, progress);
            meal.mesh.scale.set(pose.width, pose.height, pose.width);
            const eater = meal.eaterId === null ? undefined : this.npcMeshes.get(meal.eaterId);
            const targetX = eater ? eater.position.x : meal.x;
            const targetZ = eater ? eater.position.z : meal.y;
            const targetY = eater ? eater.position.y : 0;
            // Rest on the ground when there is no eater to be pulled into.
            meal.mesh.position.set(
                meal.x + (targetX - meal.x) * pose.eased,
                targetY * pose.eased,
                meal.y + (targetZ - meal.y) * pose.eased,
            );
        }
    }

    // ------------------------------------------------------------------
    // Picking & selection
    // ------------------------------------------------------------------

    /**
     * Find the subject whose mesh is under screen coordinates (ndcX, ndcY).
     *
     * Entities and tufts share one id space (the sim hands out every id, to
     * animals, plants and corpses alike), so this returns an id and the caller
     * decides what it belongs to.
     */
    pick(ndcX: number, ndcY: number, camera: THREE.OrthographicCamera): number | null {
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
        const meshes = this.pickList.map((entry) => entry.mesh);
        // Recursive, because an animal's features are a child of its body: a
        // click on a snout belongs to the animal it is attached to.
        const hits = raycaster.intersectObjects(meshes, true);
        for (const hit of hits) {
            for (let node: THREE.Object3D | null = hit.object; node; node = node.parent) {
                const found = this.pickList.find((entry) => entry.mesh === node);
                if (found) return found.id;
            }
        }
        // A tuft is a few pixels of thin blades at the god camera's framing, so
        // requiring a ray to hit one is a precision test rather than a gesture.
        // Fall back to the nearest tuft within a small screen radius — the click
        // is still deliberate (the caller has already ruled out a drag), just a
        // forgiving one. Animals are large enough to hit, so only plants get it.
        return this.nearestPlantTo(ndcX, ndcY, camera);
    }

    /** The tuft nearest to a click, if one stands within `PICK_SLOP_NDC` of it. */
    private nearestPlantTo(
        ndcX: number,
        ndcY: number,
        camera: THREE.OrthographicCamera,
    ): number | null {
        let bestId: number | null = null;
        let best = PICK_SLOP_NDC;
        const point = new THREE.Vector3();
        for (const [id, mesh] of this.plantMeshes) {
            point.set(mesh.position.x, 0, mesh.position.z).project(camera);
            const distance = Math.hypot(point.x - ndcX, point.y - ndcY);
            if (distance <= best) {
                best = distance;
                bestId = id;
            }
        }
        return bestId;
    }

    select(id: number | null): void {
        this.selectedId = id;
        this.updateRing();
    }

    private updateRing(): void {
        if (this.selectedId === null) {
            this.ring.visible = false;
            return;
        }
        // An animal or a tuft, whichever the selected id belongs to. The ring is
        // sized for an animal, so a tuft gets a smaller one instead of a circle
        // drawn at twice its width.
        const animal = this.npcMeshes.get(this.selectedId);
        const mesh = animal ?? this.plantMeshes.get(this.selectedId);
        if (!mesh) {
            this.ring.visible = false;
            return;
        }
        this.ring.visible = true;
        this.ring.scale.setScalar(animal ? 1 : PLANT_RING_SCALE);
        this.ring.position.set(mesh.position.x, 0.08, mesh.position.z);
    }
}
