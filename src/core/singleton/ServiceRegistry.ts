import { IEventBus, Subscription } from '../interfaces/IEventBus';
import { MarkdownFileRegistry } from '../../files';
import { ConflictDetectionChainManager } from '../chain/ConflictDetectionChain';
import { FileMetadataCache } from '../flyweight/FileMetadataFlyweight';
import { SaveCoordinator } from '../SaveCoordinator';

/**
 * Singleton Pattern - Service Registry
 *
 * Provides centralized access to shared services throughout the application.
 * Ensures only one instance of each service exists.
 */

export class ServiceRegistry {
    private static instance: ServiceRegistry;
    private services: Map<string, any> = new Map();

    private constructor() {
        this.initializeServices();
    }

    /**
     * Get the singleton instance
     */
    static getInstance(): ServiceRegistry {
        if (!ServiceRegistry.instance) {
            ServiceRegistry.instance = new ServiceRegistry();
        }
        return ServiceRegistry.instance;
    }

    /**
     * Register a service
     */
    register<T>(name: string, service: T): void {
        this.services.set(name, service);
        console.log(`[ServiceRegistry] Registered service: ${name}`);
    }

    /**
     * Get a service by name
     */
    get<T>(name: string): T {
        const service = this.services.get(name);
        if (!service) {
            throw new Error(`Service not found: ${name}`);
        }
        return service as T;
    }

    /**
     * Check if a service is registered
     */
    has(name: string): boolean {
        return this.services.has(name);
    }

    /**
     * Unregister a service
     */
    unregister(name: string): boolean {
        const removed = this.services.delete(name);
        if (removed) {
            console.log(`[ServiceRegistry] Unregistered service: ${name}`);
        }
        return removed;
    }

    /**
     * Get all registered service names
     */
    getServiceNames(): string[] {
        return Array.from(this.services.keys());
    }

    /**
     * Clear all services (useful for testing)
     */
    clear(): void {
        this.services.clear();
        console.log(`[ServiceRegistry] Cleared all services`);
    }

    /**
     * Initialize core services
     */
    private initializeServices(): void {
        // Core infrastructure services
        this.register('eventBus', this.createEventBus());
        this.register('fileRegistry', new MarkdownFileRegistry());

        // Coordination services
        this.register('saveCoordinator', new SaveCoordinator());
        this.register('conflictManager', new ConflictDetectionChainManager());

        // Caching services
        this.register('metadataCache', new FileMetadataCache());

        console.log(`[ServiceRegistry] Initialized ${this.services.size} core services`);
    }

    /**
     * Create event bus (placeholder - would integrate with actual EventBus)
     */
    private createEventBus(): IEventBus {
        // This would return the actual EventBus implementation
        // For now, return a mock
        return {
            publish: async (event: any) => {
                console.log(`[MockEventBus] Published event:`, event);
            },
            subscribe: (eventType: string, handler: any): Subscription => {
                console.log(`[MockEventBus] Subscribed to: ${eventType}`);
                return {
                    unsubscribe: () => {
                        console.log(`[MockEventBus] Unsubscribed from: ${eventType}`);
                    },
                    isActive: () => true
                };
            },
            unsubscribe: (eventType: string, handler: any) => {
                console.log(`[MockEventBus] Unsubscribed from: ${eventType}`);
            },
            getSubscriberCount: (eventType: string) => 0,
            clear: () => {
                console.log(`[MockEventBus] Cleared all subscribers`);
            }
        };
    }

    // Convenience getters for commonly used services

    static get eventBus(): IEventBus {
        return ServiceRegistry.getInstance().get<IEventBus>('eventBus');
    }

    static get fileRegistry(): MarkdownFileRegistry {
        return ServiceRegistry.getInstance().get<MarkdownFileRegistry>('fileRegistry');
    }

    static get saveCoordinator(): SaveCoordinator {
        return ServiceRegistry.getInstance().get<SaveCoordinator>('saveCoordinator');
    }

    static get conflictManager(): ConflictDetectionChainManager {
        return ServiceRegistry.getInstance().get<ConflictDetectionChainManager>('conflictManager');
    }

    static get metadataCache(): FileMetadataCache {
        return ServiceRegistry.getInstance().get<FileMetadataCache>('metadataCache');
    }
}

/**
 * Service Locator Pattern - Alternative to direct service access
 */
export class ServiceLocator {
    private static registry = ServiceRegistry.getInstance();

    /**
     * Resolve a service by type
     */
    static resolve<T>(serviceType: string): T {
        return this.registry.get<T>(serviceType);
    }

    /**
     * Register a service
     */
    static register<T>(serviceType: string, service: T): void {
        this.registry.register(serviceType, service);
    }

    /**
     * Check if service is available
     */
    static isAvailable(serviceType: string): boolean {
        return this.registry.has(serviceType);
    }
}

/**
 * Dependency Injection Container
 * Advanced service management with automatic dependency resolution
 */
export class DIContainer {
    private static instance: DIContainer;
    private services: Map<string, ServiceDefinition<any>> = new Map();
    private singletons: Map<string, any> = new Map();

    private constructor() {}

    static getInstance(): DIContainer {
        if (!DIContainer.instance) {
            DIContainer.instance = new DIContainer();
        }
        return DIContainer.instance;
    }

    /**
     * Register a service with its dependencies
     */
    register<T>(
        name: string,
        factory: (...deps: any[]) => T,
        dependencies: string[] = [],
        lifecycle: 'singleton' | 'transient' = 'singleton'
    ): void {
        this.services.set(name, {
            factory,
            dependencies,
            lifecycle
        });
        console.log(`[DIContainer] Registered service: ${name} (${lifecycle})`);
    }

    /**
     * Resolve a service and its dependencies
     */
    resolve<T>(name: string): T {
        const definition = this.services.get(name);
        if (!definition) {
            throw new Error(`Service not registered: ${name}`);
        }

        if (definition.lifecycle === 'singleton') {
            if (this.singletons.has(name)) {
                return this.singletons.get(name) as T;
            }
        }

        // Resolve dependencies
        const dependencies = definition.dependencies.map(dep => this.resolve(dep));

        // Create service instance
        const instance = definition.factory(...dependencies);

        if (definition.lifecycle === 'singleton') {
            this.singletons.set(name, instance);
        }

        return instance as T;
    }

    /**
     * Check if service is registered
     */
    isRegistered(name: string): boolean {
        return this.services.has(name);
    }

    /**
     * Clear all services and singletons
     */
    clear(): void {
        this.services.clear();
        this.singletons.clear();
        console.log(`[DIContainer] Cleared all services`);
    }
}

interface ServiceDefinition<T> {
    factory: (...deps: any[]) => T;
    dependencies: string[];
    lifecycle: 'singleton' | 'transient';
}

/**
 * Service Factory - Factory Method Pattern for Service Creation
 */
export abstract class ServiceFactory {
    /**
     * Create a service instance
     */
    abstract createService<T>(serviceType: string): T;

    /**
     * Get service configuration
     */
    abstract getServiceConfig(serviceType: string): ServiceConfig;
}

export class DefaultServiceFactory extends ServiceFactory {
    createService<T>(serviceType: string): T {
        // This would create services based on type
        // For now, delegate to ServiceRegistry
        return ServiceRegistry.getInstance().get<T>(serviceType);
    }

    getServiceConfig(serviceType: string): ServiceConfig {
        // Return default configuration
        return {
            enabled: true,
            maxInstances: 1,
            timeout: 30000
        };
    }
}

export interface ServiceConfig {
    enabled: boolean;
    maxInstances: number;
    timeout: number;
}

/**
 * Service Health Monitor - Observer Pattern for Service Monitoring
 */
export class ServiceHealthMonitor {
    private static instance: ServiceHealthMonitor;
    private healthChecks: Map<string, () => Promise<boolean>> = new Map();
    private listeners: Array<(service: string, healthy: boolean) => void> = [];

    private constructor() {}

    static getInstance(): ServiceHealthMonitor {
        if (!ServiceHealthMonitor.instance) {
            ServiceHealthMonitor.instance = new ServiceHealthMonitor();
        }
        return ServiceHealthMonitor.instance;
    }

    /**
     * Register a health check for a service
     */
    registerHealthCheck(serviceName: string, check: () => Promise<boolean>): void {
        this.healthChecks.set(serviceName, check);
        console.log(`[ServiceHealthMonitor] Registered health check for: ${serviceName}`);
    }

    /**
     * Check health of a specific service
     */
    async checkServiceHealth(serviceName: string): Promise<boolean> {
        const check = this.healthChecks.get(serviceName);
        if (!check) {
            return false;
        }

        try {
            return await check();
        } catch (error) {
            console.error(`[ServiceHealthMonitor] Health check failed for ${serviceName}:`, error);
            return false;
        }
    }

    /**
     * Check health of all services
     */
    async checkAllServices(): Promise<Map<string, boolean>> {
        const results = new Map<string, boolean>();

        for (const [serviceName, check] of this.healthChecks) {
            const healthy = await this.checkServiceHealth(serviceName);
            results.set(serviceName, healthy);

            // Notify listeners
            this.notifyListeners(serviceName, healthy);
        }

        return results;
    }

    /**
     * Add health status listener
     */
    addListener(listener: (service: string, healthy: boolean) => void): void {
        this.listeners.push(listener);
    }

    /**
     * Remove health status listener
     */
    removeListener(listener: (service: string, healthy: boolean) => void): void {
        const index = this.listeners.indexOf(listener);
        if (index >= 0) {
            this.listeners.splice(index, 1);
        }
    }

    private notifyListeners(service: string, healthy: boolean): void {
        this.listeners.forEach(listener => {
            try {
                listener(service, healthy);
            } catch (error) {
                console.error(`[ServiceHealthMonitor] Error notifying listener:`, error);
            }
        });
    }

    /**
     * Get registered services
     */
    getRegisteredServices(): string[] {
        return Array.from(this.healthChecks.keys());
    }
}
