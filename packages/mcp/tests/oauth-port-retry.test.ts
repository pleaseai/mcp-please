import type { Server as NetServer } from 'node:net'
import { createServer as createNetServer } from 'node:net'
import { afterEach, describe, expect, test } from 'bun:test'
import { OAuthManager } from '../src/utils/oauth/oauth-manager.js'

const TEST_HOST = '127.0.0.1' // Use 127.0.0.1 for reliable port blocking in tests

// Use different port ranges for each test to avoid conflicts between parallel tests
// Each test gets 20 ports to work with
let testPortOffset = 0
function getTestPortBase(): number {
  const base = 13300 + testPortOffset
  testPortOffset += 20
  return base
}

describe('oauth-port-retry', () => {
  // Track all servers created by tests for cleanup
  const allServers: NetServer[] = []

  // Helper to occupy a port - use 127.0.0.1 explicitly for reliable port blocking
  async function occupyPort(port: number): Promise<NetServer> {
    return new Promise((resolve, reject) => {
      const server = createNetServer()
      server.once('error', reject)
      server.listen(port, TEST_HOST, () => {
        allServers.push(server)
        resolve(server)
      })
    })
  }

  // Cleanup all servers after each test
  afterEach(async () => {
    await Promise.all(
      allServers.map(server =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        }),
      ),
    )
    allServers.length = 0
  })

  describe('findAvailablePort', () => {
    test('should use default port when available', async () => {
      const testPort = getTestPortBase()

      const manager = new OAuthManager(
        {
          serverName: 'test-server',
          serverUrl: 'https://example.com',
          callbackPort: testPort,
          callbackHost: TEST_HOST,
        },
        { debug: false },
      )

      const findPort = (manager as any).findAvailablePort.bind(manager)
      const port = await findPort()

      expect(port).toBe(testPort)
    })

    test('should skip to next port when default port is occupied', async () => {
      const testPort = getTestPortBase()

      // Occupy the default port
      await occupyPort(testPort)

      const logs: string[] = []
      const manager = new OAuthManager(
        {
          serverName: 'test-server',
          serverUrl: 'https://example.com',
          callbackPort: testPort,
          callbackHost: TEST_HOST,
        },
        {
          debug: false,
          logger: {
            info: () => {},
            error: () => {},
            debug: () => {},
            warn: (msg: string) => logs.push(msg),
          },
        },
      )

      const findPort = (manager as any).findAvailablePort.bind(manager)
      const port = await findPort()

      expect(port).toBe(testPort + 1)
      expect(logs.some(l => l.includes('in use'))).toBe(true)
    })

    test('should skip multiple occupied ports', async () => {
      const testPort = getTestPortBase()

      // Occupy first 3 ports
      await occupyPort(testPort)
      await occupyPort(testPort + 1)
      await occupyPort(testPort + 2)

      const manager = new OAuthManager(
        {
          serverName: 'test-server',
          serverUrl: 'https://example.com',
          callbackPort: testPort,
          callbackHost: TEST_HOST,
        },
        { debug: false },
      )

      const findPort = (manager as any).findAvailablePort.bind(manager)
      const port = await findPort()

      expect(port).toBe(testPort + 3)
    })

    test('should throw error when all ports exhausted', async () => {
      const testPort = getTestPortBase()

      // Occupy all 10 ports
      for (let i = 0; i < 10; i++) {
        await occupyPort(testPort + i)
      }

      const manager = new OAuthManager(
        {
          serverName: 'test-server',
          serverUrl: 'https://example.com',
          callbackPort: testPort,
          callbackHost: TEST_HOST,
        },
        { debug: false },
      )

      const findPort = (manager as any).findAvailablePort.bind(manager)

      await expect(findPort()).rejects.toThrow('All ports')
    })
  })

  describe('isPortAvailable', () => {
    test('should return true for free port', async () => {
      const testPort = getTestPortBase()

      const manager = new OAuthManager(
        {
          serverName: 'test-server',
          serverUrl: 'https://example.com',
          callbackPort: testPort,
          callbackHost: TEST_HOST,
        },
        { debug: false },
      )

      const isAvailable = (manager as any).isPortAvailable.bind(manager)
      const result = await isAvailable(testPort + 15) // Use a port within our range that's free

      expect(result).toBe(true)
    })

    test('should return false for occupied port', async () => {
      const testPort = getTestPortBase()

      await occupyPort(testPort)

      const manager = new OAuthManager(
        {
          serverName: 'test-server',
          serverUrl: 'https://example.com',
          callbackPort: testPort,
          callbackHost: TEST_HOST,
        },
        { debug: false },
      )

      const isAvailable = (manager as any).isPortAvailable.bind(manager)
      const result = await isAvailable(testPort)

      expect(result).toBe(false)
    })
  })

  describe('getCallbackPort', () => {
    test('should return configured port when actualCallbackPort is not set', () => {
      const testPort = getTestPortBase()

      const manager = new OAuthManager(
        {
          serverName: 'test-server',
          serverUrl: 'https://example.com',
          callbackPort: testPort,
          callbackHost: TEST_HOST,
        },
        { debug: false },
      )

      const getPort = (manager as any).getCallbackPort.bind(manager)
      const port = getPort()

      expect(port).toBe(testPort)
    })

    test('should return actualCallbackPort when set', async () => {
      const testPort = getTestPortBase()

      // Occupy the default port to force fallback
      await occupyPort(testPort)

      const manager = new OAuthManager(
        {
          serverName: 'test-server',
          serverUrl: 'https://example.com',
          callbackPort: testPort,
          callbackHost: TEST_HOST,
        },
        { debug: false },
      )

      // Simulate what authorize() does
      const findPort = (manager as any).findAvailablePort.bind(manager);
      (manager as any).actualCallbackPort = await findPort()

      const getPort = (manager as any).getCallbackPort.bind(manager)
      const port = getPort()

      expect(port).toBe(testPort + 1)
    })
  })
})
