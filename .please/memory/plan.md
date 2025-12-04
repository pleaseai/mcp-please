# MCP OAuth 2.1 Implementation Plan

## Overview

mcp-gateway에 OAuth 2.1 인증 지원 추가. 기존 아키텍처(동적 로딩 + search_tools)를 유지하면서 원격 HTTP/SSE MCP 서버의 OAuth 인증을 처리.

## Design Decision

### Why 방식 1 (mcp-gateway + OAuth)?

| 기준 | 방식 1 (mcp-gateway) | 방식 2 (wrapper) |
|------|---------------------|-----------------|
| Token 효율 | 높음 (5개 tool만 노출) | 낮음 (전체 tool 노출) |
| 검색 | 전체 통합 검색 | 불가 또는 분리됨 |
| 메모리 (HTTP) | ~40MB | ~40MB × N |
| 동적 로딩 | 기본 지원 | 별도 구현 필요 |
| 설정 관리 | 단일 파일 | MCP별 개별 |

### Add-Time Authentication (최종 결정)

OAuth 서버는 연결 자체가 인증을 요구하므로 (예: Asana는 SSE 연결 시 401 반환),
**`mcp add` 시점에 인증을 완료**하고 토큰을 저장한다.

```
mcp add 시점:
├── Public 서버: 설정 저장 ✓
└── OAuth 서버:
    └── OAuth 인증 (브라우저) → 토큰 저장 → 설정 저장 ✓

index 시점:
├── 토큰 있음 → 연결 → tool 수집 ✓
└── 토큰 없음/만료 → refresh 또는 에러 메시지

call_tool 시점:
├── 토큰 유효 → 실행
├── 토큰 만료 → refresh → 실행
└── refresh 실패 → 에러 (mcp auth 명령으로 재인증 안내)
```

**참고**: Asana MCP 서버 확인 결과
- SSE 연결: `401 {"error":"invalid_token"}` 반환
- `.well-known/oauth-protected-resource`: 공개 (RFC9728)
- `.well-known/oauth-authorization-server`: 공개 (RFC8414)
- Dynamic Registration: 지원 (`registration_endpoint` 존재)
- PKCE: 지원 (`code_challenge_methods_supported: ["plain", "S256"]`)

---

## CLI Usage

```bash
# OAuth 서버 추가 (인증 flow 자동 시작)
mcp-gateway mcp add asana https://mcp.asana.com/sse -t sse --auth oauth2 --scopes default

# 인증 상태 확인
mcp-gateway mcp auth --list

# 재인증
mcp-gateway mcp auth asana

# 인증 취소
mcp-gateway mcp auth asana --revoke
```

---

## Configuration Schema

```typescript
interface McpServerConfig {
  url?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  transport?: 'stdio' | 'http' | 'sse'

  // Authorization
  authorization?: {
    type: 'none' | 'bearer' | 'oauth2'

    // For bearer
    token?: string  // 직접 또는 ${ENV_VAR}

    // For oauth2
    oauth?: {
      clientId?: string           // Optional (dynamic registration)
      clientSecret?: string       // For confidential clients
      authorizationServer?: string // Optional (RFC9728 discovery)
      scopes?: string[]
      resource?: string           // RFC8707
    }
  }
}
```

### Example Configuration

```json
{
  "mcpServers": {
    "nuxt-ui": {
      "url": "https://ui.nuxt.com/mcp",
      "transport": "http"
    },
    "asana": {
      "url": "https://mcp.asana.com/sse",
      "transport": "sse",
      "authorization": {
        "type": "oauth2",
        "oauth": {
          "scopes": ["default"]
        }
      }
    }
  }
}
```

---

## Implementation Status

### Completed ✅

#### Phase 1: OAuth Module
- [x] `oauth/types.ts` - OAuth interfaces (OAuthMetadata, OAuthSession, AuthorizationConfig)
- [x] `oauth/pkce.ts` - PKCE S256 implementation
- [x] `oauth/token-storage.ts` - Secure file storage (`~/.please/oauth/tokens/`)
- [x] `oauth/oauth-manager.ts` - Complete OAuth flow orchestration
- [x] `oauth/index.ts` - Module exports

#### Phase 2: CLI Integration
- [x] `mcp add --auth` option with OAuth flow
- [x] `mcp auth` subcommand (list, authenticate, revoke)
- [x] McpServerConfig extended with `authorization` field

#### Phase 3: Index Integration ✅
- [x] `mcp-client.ts` - MCP client for connecting to servers and fetching tools
- [x] `mcp-config-loader.ts` - Config loader with OAuth token integration
- [x] `index-cmd.ts` - Auto-discover MCP servers and use stored tokens

### Pending

#### Phase 4: Testing
- [ ] Unit tests for PKCE, token storage
- [ ] Integration tests for auth flow
- [ ] E2E test with Asana MCP server

---

## Module Structure (Implemented)

```
packages/mcp/src/utils/
├── oauth/
│   ├── index.ts                # Public exports
│   ├── types.ts                # OAuth interfaces
│   ├── pkce.ts                 # PKCE (S256) + state generation
│   ├── token-storage.ts        # ~/.please/oauth/tokens/<hash>.json
│   └── oauth-manager.ts        # Complete flow: discovery → registration → auth → tokens
├── mcp-client.ts               # MCP client for server connections
└── mcp-config-loader.ts        # Config loader with OAuth integration
```

---

## Token Storage Structure

```
~/.please/oauth/
├── tokens/                     # Access/refresh tokens
│   └── <server-hash>.json
└── clients/                    # Dynamic registration cache
    └── <server-hash>.json
```

### Token File Format

```json
{
  "clientInfo": {
    "client_id": "dynamically-registered-id"
  },
  "tokens": {
    "access_token": "eyJ...",
    "refresh_token": "refresh-token",
    "token_type": "Bearer",
    "expires_in": 3600
  },
  "expiresAt": 1735689600
}
```

---

## Security Considerations

1. **PKCE Required** - All clients use S256
2. **Token Storage** - File permissions 0600
3. **Callback Server** - 127.0.0.1 only, port 3334
4. **State Parameter** - CSRF protection with random state
5. **Automatic Refresh** - Tokens refreshed 5 minutes before expiry

---

## Dependencies

```json
{
  "dependencies": {
    "open": "^10.1.0"
  }
}
```

Node.js built-ins: `crypto`, `http`, `fs`, `os`, `path`

---

## References

- [MCP Authorization Spec](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization)
- [OAuth 2.1 Draft](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1)
- [RFC8414 - OAuth Server Metadata](https://datatracker.ietf.org/doc/html/rfc8414)
- [RFC9728 - Protected Resource Metadata](https://datatracker.ietf.org/doc/html/rfc9728)
- [RFC7591 - Dynamic Client Registration](https://datatracker.ietf.org/doc/html/rfc7591)
- [RFC8707 - Resource Indicators](https://datatracker.ietf.org/doc/html/rfc8707)
