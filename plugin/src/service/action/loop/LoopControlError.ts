export class LoopBreakError extends Error {
    constructor() {
        super("Loop break requested");
        this.name = "LoopBreakError";
    }
}

export class LoopContinueError extends Error {
    constructor() {
        super("Loop continue requested");
        this.name = "LoopContinueError";
    }
}

export class LoopMaxIterationError extends Error {
    constructor(max: number) {
        super(`Loop exceeded maximum iterations: ${max}`);
        this.name = "LoopMaxIterationError";
    }
}

export class LoopTimeoutError extends Error {
    constructor(timeout: number) {
        super(`Loop execution exceeded timeout: ${timeout}ms`);
        this.name = "LoopTimeoutError";
    }
}

