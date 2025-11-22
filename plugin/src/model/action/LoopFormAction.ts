import { BaseFormAction } from "./BaseFormAction";
import { FormActionType } from "../enums/FormActionType";
import { LoopType } from "../enums/LoopType";
import { ErrorHandlingStrategy } from "../enums/ErrorHandlingStrategy";

export interface PaginationLoopConfig {
    currentPageVariable: string;
    hasNextPageCondition: string;
    pageSizeVariable?: string;
    totalPageVariable?: string;
    totalItemsVariable?: string;
    requestInterval?: number;
    maxPages?: number;
}

export class LoopFormAction extends BaseFormAction {
    type: FormActionType.LOOP;

    loopType: LoopType;
    actionGroupId?: string;

    listDataSource?: string;
    conditionExpression?: string;
    countStart?: number;
    countEnd?: number;
    countStep?: number;
    paginationConfig?: PaginationLoopConfig;

    itemVariableName: string;
    indexVariableName: string;
    totalVariableName: string;

    maxIterations: number;
    timeout?: number;
    singleIterationTimeout?: number;
    errorHandlingStrategy: ErrorHandlingStrategy;
    retryCount?: number;
    retryDelay?: number;

    showProgress?: boolean;

    constructor(partial?: Partial<LoopFormAction>) {
        super(partial);
        this.type = FormActionType.LOOP;
        this.loopType = LoopType.LIST;
        this.itemVariableName = "item";
        this.indexVariableName = "index";
        this.totalVariableName = "total";
        this.maxIterations = 1000;
        this.countStart = 0;
        this.countEnd = 0;
        this.countStep = 1;
        this.errorHandlingStrategy = ErrorHandlingStrategy.STOP;
        Object.assign(this, partial);
    }
}

