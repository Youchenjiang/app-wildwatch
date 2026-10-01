import { gaussian, type RNG } from "./rng";

export interface BrainSpec {
    inputSize: number;
    hiddenSize: number;
    outputSize: number;
}

/**
 * Small feed-forward neural network (input -> hidden -> output, tanh).
 *
 * This is the "genome" the next milestones will evolve and let learn
 * lifelong; the structure already supports clone + mutation so the sim can
 * run end to end.
 */
export class Brain {
    readonly w1: Float32Array;
    readonly b1: Float32Array;
    readonly w2: Float32Array;
    readonly b2: Float32Array;

    constructor(
        readonly spec: BrainSpec,
        w1: Float32Array,
        b1: Float32Array,
        w2: Float32Array,
        b2: Float32Array,
    ) {
        this.w1 = w1;
        this.b1 = b1;
        this.w2 = w2;
        this.b2 = b2;
    }

    static random(spec: BrainSpec, rng: RNG): Brain {
        const scale = 1 / Math.sqrt(spec.inputSize);
        const w1 = new Float32Array(spec.inputSize * spec.hiddenSize);
        const b1 = new Float32Array(spec.hiddenSize);
        const w2 = new Float32Array(spec.hiddenSize * spec.outputSize);
        const b2 = new Float32Array(spec.outputSize);
        const fill = (a: Float32Array): void => {
            for (let i = 0; i < a.length; i++) a[i] = gaussian(rng) * scale;
        };
        fill(w1);
        fill(w2);
        return new Brain(spec, w1, b1, w2, b2);
    }

    clone(): Brain {
        return new Brain(
            this.spec,
            new Float32Array(this.w1),
            new Float32Array(this.b1),
            new Float32Array(this.w2),
            new Float32Array(this.b2),
        );
    }

    /**
     * Uniform crossover: each weight is taken from this brain or `other` with
     * probability 0.5. Returns a NEW brain; both parents stay untouched.
     */
    crossover(other: Brain, rng: RNG): Brain {
        const child = this.clone();
        const mix = (a: Float32Array, b: Float32Array): void => {
            for (let i = 0; i < a.length; i++) {
                if (rng() < 0.5) a[i] = b[i];
            }
        };
        mix(child.w1, other.w1);
        mix(child.b1, other.b1);
        mix(child.w2, other.w2);
        mix(child.b2, other.b2);
        return child;
    }

    /** In-place gaussian mutation of every weight, applied with `rate` probability. */
    mutate(rate: number, sigma: number, rng: RNG): void {
        const apply = (a: Float32Array): void => {
            for (let i = 0; i < a.length; i++) {
                if (rng() < rate) a[i] += gaussian(rng) * sigma;
            }
        };
        apply(this.w1);
        apply(this.b1);
        apply(this.w2);
        apply(this.b2);
    }

    forward(inputs: readonly number[]): Float32Array {
        const { inputSize, hiddenSize, outputSize } = this.spec;
        const hidden = new Float32Array(hiddenSize);
        for (let j = 0; j < hiddenSize; j++) {
            let sum = this.b1[j];
            for (let i = 0; i < inputSize; i++) sum += inputs[i] * this.w1[j * inputSize + i];
            hidden[j] = Math.tanh(sum);
        }
        const out = new Float32Array(outputSize);
        for (let k = 0; k < outputSize; k++) {
            let sum = this.b2[k];
            for (let j = 0; j < hiddenSize; j++) sum += hidden[j] * this.w2[k * hiddenSize + j];
            out[k] = Math.tanh(sum);
        }
        return out;
    }

    /**
     * One step of behavior cloning / imitation learning via backpropagation.
     * Nudges weights so that forward(inputs) moves closer to targetOutput.
     */
    learnImitation(inputs: readonly number[], targetOutput: readonly number[], learningRate = 0.05): void {
        const { inputSize, hiddenSize, outputSize } = this.spec;
        const hidden = new Float32Array(hiddenSize);
        for (let j = 0; j < hiddenSize; j++) {
            let sum = this.b1[j];
            for (let i = 0; i < inputSize; i++) sum += inputs[i] * this.w1[j * inputSize + i];
            hidden[j] = Math.tanh(sum);
        }
        const out = new Float32Array(outputSize);
        for (let k = 0; k < outputSize; k++) {
            let sum = this.b2[k];
            for (let j = 0; j < hiddenSize; j++) sum += hidden[j] * this.w2[k * hiddenSize + j];
            out[k] = Math.tanh(sum);
        }

        // Output error gradient: (target - out) * (1 - out^2)
        const outDelta = new Float32Array(outputSize);
        for (let k = 0; k < outputSize; k++) {
            const error = targetOutput[k] - out[k];
            outDelta[k] = error * (1 - out[k] * out[k]);
        }

        // Backpropagate to hidden layer
        const hiddenDelta = new Float32Array(hiddenSize);
        for (let j = 0; j < hiddenSize; j++) {
            let error = 0;
            for (let k = 0; k < outputSize; k++) error += outDelta[k] * this.w2[k * hiddenSize + j];
            hiddenDelta[j] = error * (1 - hidden[j] * hidden[j]);
        }

        this.updateWeights(inputs, hidden, outDelta, hiddenDelta, learningRate);
    }

    private updateWeights(
        inputs: readonly number[],
        hidden: Float32Array,
        outDelta: Float32Array,
        hiddenDelta: Float32Array,
        learningRate: number,
    ): void {
        const { inputSize, hiddenSize, outputSize } = this.spec;
        for (let k = 0; k < outputSize; k++) {
            this.b2[k] += learningRate * outDelta[k];
            for (let j = 0; j < hiddenSize; j++) {
                this.w2[k * hiddenSize + j] += learningRate * outDelta[k] * hidden[j];
            }
        }
        for (let j = 0; j < hiddenSize; j++) {
            this.b1[j] += learningRate * hiddenDelta[j];
            for (let i = 0; i < inputSize; i++) {
                this.w1[j * inputSize + i] += learningRate * hiddenDelta[j] * inputs[i];
            }
        }
    }
}