import React, { createContext, useContext, ReactNode } from 'react';
import { LoopType } from 'src/model/enums/LoopType';

/**
 * 循环上下文接口
 */
export interface LoopContextValue {
    isInsideLoop: boolean;
    loopVariables?: string[]; // 可用的循环变量名列表
    loopType?: LoopType; // 循环类型
}

/**
 * 默认循环上下文值
 */
const defaultValue: LoopContextValue = {
    isInsideLoop: false,
};

/**
 * 循环上下文
 */
const LoopContext = createContext<LoopContextValue>(defaultValue);

/**
 * 循环上下文 Provider 属性
 */
export interface LoopProviderProps {
    children: ReactNode;
    value: LoopContextValue;
}

/**
 * 循环上下文 Provider
 */
export function LoopProvider({ children, value }: LoopProviderProps) {
    return <LoopContext.Provider value={value}>{children}</LoopContext.Provider>;
}

/**
 * 使用循环上下文的 Hook
 */
export function useLoopContext(): LoopContextValue {
    return useContext(LoopContext);
}

/**
 * HOC: 为组件提供循环上下文
 */
export function withLoopContext<P extends object>(
    Component: React.ComponentType<P>,
    loopContext: LoopContextValue
) {
    return function WithLoopContext(props: P) {
        return (
            <LoopProvider value={loopContext}>
                <Component {...props} />
            </LoopProvider>
        );
    };
}