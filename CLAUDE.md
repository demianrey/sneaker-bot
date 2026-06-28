# CLAUDE.md — SneakerDrop Bot

Guía de arquitectura para Claude Code al trabajar con este repositorio.

## Correr la app

```bash
pm2 restart sneaker-bot   # aplicar cambios en .js
pm2 logs sneaker-bot      # ver logs en vivo
node index.js             # modo dev directo
```

Sin build step. Los archivos `data/*.json` se recargan automáticamente cada 60s sin reiniciar (hot-reload). Los archivos `.js` requieren reinicio del proceso.

## Variables de entorno (`.env`)

```
PORT=3000
PHONE_NUMBER_ID        # Meta WhatsApp Business — ID del número
WHATSAPP_TOKEN         # Meta — token permanente de acceso
VERIFY_TOKEN           # Token de verificación del webhook
OPENAI_API_KEY         # Para LLM principal (gpt-4o-mini)
CLAUDE_API_KEY         # Para LLM fallback (claude-haiku)
LLM_PROVIDER           # "openai" (default) o "claude"
ADMIN_PASSWORD         # Contraseña del panel admin
```

## Arquitectura

Express HTTP que recibe webhooks de Meta WhatsApp Cloud API y responde por la misma API.

**Flujo de una petición:**
```
Meta webhook → index.js → intents.js (handleMessage) → reply → whatsapp.js
```

### intents.js
Motor principal de routing. Procesa mensajes en orden de prioridad:
1. Filtro de lenguaje inapropiado
2. Flujo genérico activo (catálogo, soporte, seguimiento, etc.)
3. Flujo de compra activo
4. Trigger de menú (hola, buenas, menú, inicio...)
5. Coincidencia de opción por número o alias de intent
6. IA fallback → llm.js

### Sistema de flujos (`data/flows.json`)
Cada opción del menú tiene un `intent`. Los intents pueden:
- Responder con texto directo (`response`)
- Iniciar un flujo multi-paso (`flowId`) — el estado se guarda en `state.js`

Los pasos de un flujo soportan `inputType: "text"` o `inputType: "choice"`. Los pasos con `condition` se saltan si la variable condicionante no coincide (ej: omitir dirección si eligió recoger en tienda).

### Flujos disponibles
| flowId | Propósito |
|--------|-----------|
| `flow_comprar` | Recolecta modelo, talla, dirección, método de pago |
| `flow_seguimiento` | Consulta estado de pedido (genera ticket para el asesor) |
| `flow_soporte` | Cambios, devoluciones, problemas — genera ticket |

### State (`state.js`)
Sesión en memoria por número de WhatsApp. TTL configurable (`STATE_TTL_MS`). Se pierde al reiniciar el proceso — no usar para datos críticos.

### Config (`config.js`)
Proxy sobre `data/config.json`. Hot-reload cada 60s. Todos los valores son accesibles como `config.NOMBRE_VARIABLE`. Los `{{PLACEHOLDERS}}` en flows, prompt y knowledge base se sustituyen en runtime.

### LLM (`llm.js`)
- Principal: OpenAI `gpt-4o-mini`
- Fallback: Claude `claude-haiku-4-5-20251001`
- System prompt desde `data/prompt.json` + knowledge base inyectada en cada llamada
- Historial por usuario máx 12 mensajes (6 intercambios)

### Admin panel (`public/admin.html`)
SPA single-file. Autenticación por password header. Permite editar:
- Config (variables de entorno del negocio)
- Flujos y opciones del menú
- System prompt
- Base de conocimiento
- Tickets generados por los flujos
- Logs de conversaciones
- Broadcast a usuarios activos

## Personalizar para un negocio diferente

Para adaptar este bot a otra tienda o producto:
1. Editar `data/config.json` con los datos del negocio
2. Editar `data/prompt.json` con la personalidad y reglas del bot
3. Editar `data/flows.json` — opciones del menú y flujos multi-paso
4. Editar `data/knowledge.json` — preguntas frecuentes y políticas
5. Los intents en `intents.js` → `INTENT_ALIASES` deben coincidir con los `intent` de `flows.json`
