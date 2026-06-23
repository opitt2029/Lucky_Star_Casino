import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '../..')

const services = [
  ['member', 'backend/member-service', 'webmvc'],
  ['wallet', 'backend/wallet-service', 'webmvc'],
  ['game', 'backend/game-service', 'webmvc'],
  ['rank', 'backend/rank-service', 'webmvc'],
  ['admin', 'backend/admin-service', 'webmvc'],
  ['notification', 'backend/notification-service', 'webmvc'],
  ['gateway', 'backend/gateway-service', 'webflux'],
]

function read(path) {
  return readFileSync(resolve(root, path), 'utf8')
}

describe('T-092 Swagger / OpenAPI contract', () => {
  test('root pom manages springdoc versions for MVC and WebFlux starters', () => {
    const pom = read('pom.xml')
    assert.match(pom, /<springdoc\.version>2\.6\.0<\/springdoc\.version>/)
    assert.match(pom, /springdoc-openapi-starter-webmvc-ui/)
    assert.match(pom, /springdoc-openapi-starter-webflux-ui/)
  })

  test('every backend service includes the expected springdoc starter', () => {
    for (const [, path, stack] of services) {
      const pom = read(`${path}/pom.xml`)
      assert.match(pom, new RegExp(`springdoc-openapi-starter-${stack}-ui`), `${path} missing springdoc ${stack}`)
    }
  })

  test('REST and notification services define OpenAPI metadata and JWT security scheme', () => {
    for (const [name, path] of services.filter(([, , stack]) => stack === 'webmvc')) {
      const configPath = `${path}/src/main/java/com/luckystar/${name}/config/OpenApiConfig.java`
      assert.ok(existsSync(resolve(root, configPath)), `${configPath} does not exist`)
      const config = read(configPath)
      assert.match(config, /@OpenAPIDefinition/)
      assert.match(config, /@SecurityScheme/)
      assert.match(config, /SecuritySchemeType\.HTTP/)
    }
  })

  test('gateway aggregates every service api-docs endpoint in Swagger UI', () => {
    const yml = read('backend/gateway-service/src/main/resources/application.yml')
    for (const [name] of services.filter(([service]) => service !== 'gateway')) {
      assert.match(yml, new RegExp(`id: openapi-${name}`))
      assert.match(yml, new RegExp(`Path=/v3/api-docs/${name}`))
      assert.match(yml, new RegExp(`RewritePath=/v3/api-docs/${name}, /v3/api-docs`))
      assert.match(yml, new RegExp(`name: ${name}-service`))
      assert.match(yml, new RegExp(`url: /v3/api-docs/${name}`))
    }
  })

  test('gateway allows Swagger UI and proxied api-docs without JWT', () => {
    const yml = read('backend/gateway-service/src/main/resources/application.yml')
    assert.match(yml, /- \/swagger-ui/)
    assert.match(yml, /- \/v3\/api-docs/)
    assert.match(yml, /- \/webjars/)
  })
})
