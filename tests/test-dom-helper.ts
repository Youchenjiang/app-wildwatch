export interface MockElement {
    tagName: string;
    id: string;
    className: string;
    textContent: string;
    innerHTML: string;
    value: string;
    hidden: boolean;
    children: MockElement[];
    classList: {
        add(c: string): void;
        remove(c: string): void;
        toggle(c: string, force?: boolean): boolean;
        contains(c: string): boolean;
    };
    appendChild(child: MockElement): MockElement;
    addEventListener(event: string, fn: (evt: unknown) => void): void;
    dispatchEvent(evt: { type: string; [key: string]: unknown }): void;
    click(): void;
    querySelector<E = MockElement>(selector: string): E | null;
    querySelectorAll<E = MockElement>(selector: string): E[];
}

/**
 * Lightweight mock DOM element helper for Vitest suites running in node environment.
 */
export function createMockElement(tag = "div"): MockElement {
    const listeners: Record<string, ((evt: unknown) => void)[]> = {};
    const classes = new Set<string>();
    const children: MockElement[] = [];
    const elementsById: Record<string, MockElement> = {};

    const el: MockElement = {
        tagName: tag.toUpperCase(),
        id: "",
        className: "",
        textContent: "",
        innerHTML: "",
        value: "1.0",
        hidden: false,
        children,
        classList: {
            add: (c: string) => classes.add(c),
            remove: (c: string) => classes.delete(c),
            toggle: (c: string, force?: boolean) => {
                if (force === undefined) {
                    if (classes.has(c)) classes.delete(c);
                    else classes.add(c);
                } else if (force) {
                    classes.add(c);
                } else {
                    classes.delete(c);
                }
                return classes.has(c);
            },
            contains: (c: string) => classes.has(c),
        },
        appendChild(child: MockElement) {
            children.push(child);
            return child;
        },
        addEventListener(event: string, fn: (evt: unknown) => void) {
            listeners[event] = listeners[event] || [];
            listeners[event].push(fn);
        },
        dispatchEvent(evt: { type: string; [key: string]: unknown }) {
            for (const fn of listeners[evt.type] || []) fn(evt);
        },
        click() {
            this.dispatchEvent({ type: "click" });
        },
        querySelector<E = MockElement>(selector: string): E | null {
            const idMatch = selector.match(/#([\w-]+)/);
            if (idMatch) {
                const targetId = idMatch[1];
                if (el.id === targetId) return el as unknown as E;
                for (const child of children) {
                    const found = child.querySelector<E>(selector);
                    if (found) return found;
                }
                if (!elementsById[targetId]) {
                    const sub = createMockElement();
                    sub.id = targetId;
                    elementsById[targetId] = sub;
                }
                return elementsById[targetId] as unknown as E;
            }
            return null;
        },
        querySelectorAll<E = MockElement>() {
            return [] as E[];
        },
    };
    return el;
}

export function asHTMLElement(el: MockElement): HTMLElement {
    return el as unknown as HTMLElement;
}
