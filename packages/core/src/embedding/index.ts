import type { EmbeddingProviderConfig, EmbeddingProviderType } from '../types/index.js'
import type { EmbeddingProvider } from './provider.js'
import { MDBRLeafEmbeddingProvider } from './providers/mdbr-leaf.js'
import { MiniLMEmbeddingProvider } from './providers/minilm.js'
import { OpenAIEmbeddingProvider } from './providers/openai.js'
import { VoyageAIEmbeddingProvider } from './providers/voyage.js'

export { type EmbeddingProvider } from './provider.js'
export { MDBRLeafEmbeddingProvider } from './providers/mdbr-leaf.js'
export { MiniLMEmbeddingProvider } from './providers/minilm.js'
export { OpenAIEmbeddingProvider } from './providers/openai.js'
export { VoyageAIEmbeddingProvider } from './providers/voyage.js'

/**
 * Custom provider factory function type
 */
type ProviderFactory = (config: EmbeddingProviderConfig) => EmbeddingProvider

/**
 * Registry for embedding providers
 */
export class EmbeddingProviderRegistry {
  private customProviders: Map<string, ProviderFactory>

  constructor() {
    this.customProviders = new Map()
  }

  /**
   * Register a custom provider factory
   */
  register(type: string, factory: ProviderFactory): void {
    this.customProviders.set(type, factory)
  }

  /**
   * Create a provider from configuration
   */
  create(config: EmbeddingProviderConfig): EmbeddingProvider {
    // Check custom providers first
    const customFactory = this.customProviders.get(config.type)
    if (customFactory) {
      return customFactory(config)
    }

    // Built-in providers (format: 'location:model')
    switch (config.type) {
      case 'local:minilm':
        return new MiniLMEmbeddingProvider(config.model)

      case 'local:mdbr-leaf':
        return new MDBRLeafEmbeddingProvider(config.model, config.dimensions)

      case 'api:openai':
        return new OpenAIEmbeddingProvider({
          model: config.model,
          apiKey: config.apiKey,
          apiBase: config.apiBase,
          dimensions: config.dimensions,
        })

      case 'api:voyage':
        return new VoyageAIEmbeddingProvider({
          model: config.model,
          apiKey: config.apiKey,
          apiBase: config.apiBase,
          dimensions: config.dimensions,
        })

      default:
        throw new Error(
          `Unknown embedding provider type: ${config.type}. `
          + `Available types: ${this.getAvailableTypes().join(', ')}`,
        )
    }
  }

  /**
   * Get available provider types
   */
  getAvailableTypes(): string[] {
    const builtIn: EmbeddingProviderType[] = [
      'local:minilm',
      'local:mdbr-leaf',
      'api:openai',
      'api:voyage',
    ]
    const custom = Array.from(this.customProviders.keys())
    return [...builtIn, ...custom]
  }
}

/**
 * Default registry instance
 */
export const defaultRegistry = new EmbeddingProviderRegistry()

/**
 * Helper function to create a provider from config
 */
export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  return defaultRegistry.create(config)
}
