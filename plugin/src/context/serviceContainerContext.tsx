import { createContext, useContext, ReactNode } from "react";
import { ServiceContainer } from "src/service/ServiceContainer";

/**
 * 服务容器 Context
 * 用于在 React 组件树中共享服务实例
 */
export const ServiceContainerContext = createContext<ServiceContainer | undefined>(undefined);

/**
 * 服务容器 Provider 属性
 */
export interface ServiceContainerProviderProps {
    children: ReactNode;
    services: ServiceContainer;
}

/**
 * 服务容器 Provider
 */
export function ServiceContainerProvider({ children, services }: ServiceContainerProviderProps) {
    return (
        <ServiceContainerContext.Provider value={services}>
            {children}
        </ServiceContainerContext.Provider>
    );
}

/**
 * 获取服务容器的 Hook
 * @throws Error 如果在 ServiceContainerProvider 外部使用
 */
export function useServiceContainer(): ServiceContainer {
    const services = useContext(ServiceContainerContext);
    if (!services) {
        throw new Error("useServiceContainer 必须在 ServiceContainerProvider 内部使用");
    }
    return services;
}

/**
 * 获取 FormIntegrationService 的便捷 Hook
 */
export function useFormIntegrationService() {
    const services = useServiceContainer();
    return services.formIntegrationService;
}

/**
 * 获取 FormService 的便捷 Hook
 */
export function useFormService() {
    const services = useServiceContainer();
    return services.formService;
}

/**
 * 获取 FormScriptService 的便捷 Hook
 */
export function useFormScriptService() {
    const services = useServiceContainer();
    return services.formScriptService;
}
