/**
 * Lightweight mock DOM element helper for Vitest suites running in node environment.
 */
export function createMockElement(tag = "div"): any {
    const listeners: Record<string, Function[]> = {};
    const classes = new Set<string>();
    const children: any[] = [];
    const elementsById: Record<string, any> = {};

    const el: any = {
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
        appendChild(child: any) {
            children.push(child);
            return child;
        },
        addEventListener(event: string, fn: Function) {
            listeners[event] = listeners[event] || [];
            listeners[event].push(fn);
        },
        dispatchEvent(evt: any) {
            for (const fn of listeners[evt.type] || []) fn(evt);
        },
        click() {
            this.dispatchEvent({ type: "click" });
        },
        querySelector(selector: string) {
            const idMatch = selector.match(/#([\w-]+)/);
            if (idMatch) {
                const targetId = idMatch[1];
                if (el.id === targetId) return el;
                for (const child of children) {
                    const found = child.querySelector(selector);
                    if (found) return found;
                }
                if (!elementsById[targetId]) {
                    const sub = createMockElement();
                    sub.id = targetId;
                    elementsById[targetId] = sub;
                }
                return elementsById[targetId];
            }
            return null;
        },
        querySelectorAll() {
            return [];
        },
    };
    return el;
}
