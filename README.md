# DevBrain v2.0

**Offline Code Intelligence Platform** — Multi-agent RAG over local codebases with multimodal analysis, P2P delegation, real-time monitoring, and fine-tuning. Powered entirely by QVAC SDK.

> **Track:** General Purpose (up to 32GB RAM)
> **License:** Apache 2.0
> **Cloud Dependencies:** Zero. Fully air-gapped capable.

---

## What It Does

DevBrain turns any local codebase into a queryable AI-powered knowledge base. Ask questions about your code in natural language — get instant answers with file references, explanations, bug analysis, documentation generation, and refactoring suggestions.

All inference runs **100% on-device** using QVAC SDK. No data ever leaves your machine.

### Key Features

- **Multi-Agent Orchestration** — Router, RAG, Code, Tool, Doc, and Vision agents collaborate on each query
- **Real-time Streaming** — Token-by-token response via SSE (Server-Sent Events)
- **Code-aware RAG** — Intelligent chunking by functions/classes, not naive character splits
- **Tool Calling** — Agents autonomously read files, search code, query git, and generate trees
- **P2P Delegated Inference** — Query your desktop's DevBrain from a phone via Holepunch DHT
- **Multimodal Analysis** — Drop screenshots, architecture diagrams, or code photos for analysis
- **Voice Input/Output** — STT for queries, TTS for responses (Psy audio models)
- **Real-time File Monitoring** — Watches codebase for changes, auto-re-indexes
- **Fine-tuning Pipeline** — Generate LoRA adapters trained on your codebase via QVAC Fabric
- **Security Hardened** — Prompt injection detection, path traversal prevention, output filtering
- **Performance Dashboard** — Live metrics: tokens/sec, TTFT, query count, uptime

---

## Architecture

```
User Query (text / image / voice)
         ↓
    Security Guard (input sanitization + injection detection)
         ↓
    STT Agent (if voice input → transcription)
         ↓
    Router Agent (intent classification)
         ↓
    Orchestrator
    ├── RAG Agent (vector search over indexed codebase)
    ├── Code Agent (analysis, explanation, bug finding, refactoring)
    ├── Tool Agent (file read, search, git ops, directory tree)
    ├── Doc Agent (documentation generation)
    └── Vision Agent (image/screenshot analysis)
         ↓
    Output Filter (security check + credential redaction)
         ↓
    Streaming Response (SSE tokens + metadata)
```

### P2P Delegation Flow

```
Phone/Tablet (thin client)
    ↓ Holepunch DHT
Desktop/Laptop (DevBrain provider)
    ↓
Full multi-agent pipeline
    ↓
Results streamed back to phone
```

---

## QVAC SDK Integration

| Capability | QVAC API Used | Purpose |
|---|---|---|
| LLM Inference | `qvac.completion()` | Multi-agent reasoning + tool calling |
| Embeddings | `qvac.embed()` | Code-aware vector embeddings |
| RAG Ingest | `qvac.ragIngest()` | Index codebase into vector store |
| RAG Search | `qvac.ragSearch()` | Semantic code retrieval |
| Multimodal | `qvac.completion()` + image | Screenshot/diagram analysis |
| Text-to-Speech | `qvac.tts()` | Voice output |
| Speech-to-Text | `qvac.transcribe()` | Voice input |
| P2P Provider | `qvac.startQVACProvider()` | Serve inference to remote peers |
| P2P Client | `qvac.connectToQVACProvider()` | Delegate queries to powerful device |
| Fine-tuning | `qvac.fineTune()` | LoRA adapter training |
| Model Mgmt | `qvac.loadModel()` / `unloadModel()` | Lifecycle management |

---

## Models Used

| Role | Model | Size | Source |
|---|---|---|---|
| Primary LLM | Psy 4B Instruct Q4_K_M | ~2.6GB | QVAC Psy |
| Vision | Psy Vision Q4_K_M | ~4GB | QVAC Psy |
| TTS | Psy TTS | ~500MB | QVAC Psy |
| STT | Psy STT (Whisper) | ~150MB | QVAC Psy |
| Embeddings | GTE-Large FP16 | ~0.7GB | Community |
| Fallback LLM | Llama 3.2 1B Q4_0 | ~0.7GB | Community |

**Total memory footprint:** ~8.5GB peak (fits comfortably in 16GB RAM)

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/devbrain.git
cd devbrain

# Install dependencies
npm install

# Start DevBrain (indexes current directory)
node src/index.js --path ./your-project

# Start with file watching (real-time re-indexing)
node src/index.js --path ./your-project --watch

# Open the web UI
open http://localhost:3000
```

### CLI Options

```
--path <dir>       Codebase directory to index (default: current dir)
--port <number>    HTTP server port (default: 3000)
--workspace <name> RAG workspace name (default: devbrain-default)
--watch            Enable real-time file monitoring
--no-p2p           Skip P2P provider startup
```

### P2P Client (from phone/other device)

```bash
# On the remote device, connect to the provider
node src/p2p/client.js --key <provider-public-key> --interactive
```

### Fine-tuning

```bash
# Generate LoRA adapter from codebase
node src/finetune/train.js --path ./your-project --epochs 3
```

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/query` | Send a query (blocking) |
| POST | `/api/query/stream` | Send a query (SSE streaming) |
| POST | `/api/index` | Trigger codebase re-indexing |
| GET | `/api/status` | Full system status |
| GET | `/api/stats` | Session performance metrics |
| GET | `/api/logs` | Inference log entries |
| GET | `/api/events` | SSE stream of file changes |
| POST | `/api/tts` | Text-to-speech synthesis |
| POST | `/api/models/load` | Reload all models |

### Example: Streaming Query

```bash
curl -X POST http://localhost:3000/api/query/stream \
  -H 'Content-Type: application/json' \
  -d '{"query": "Explain the orchestrator agent"}' \
  --no-buffer
```

### Example: Image Analysis

```bash
curl -X POST http://localhost:3000/api/query \
  -H 'Content-Type: application/json' \
  -d '{"query": "What does this diagram show?", "imageData": "<base64>", "imageMimeType": "image/png"}'
```

---

## Project Structure

```
DevBrain/
├── src/
│   ├── index.js                # Entry point with startup orchestration
│   ├── server.js               # Express HTTP + SSE streaming server
│   ├── models.js               # Multi-model loader (Psy, Vision, TTS, STT)
│   ├── logger.js               # Structured inference logging + session stats
│   ├── agents/
│   │   ├── orchestrator.js     # Multi-agent pipeline with streaming
│   │   ├── router.js           # Intent classifier (7 intents)
│   │   ├── rag.js              # Vector search agent
│   │   ├── code.js             # Code analysis (explain, bug, refactor)
│   │   ├── tool.js             # Tool-calling agent (4 tools)
│   │   ├── doc.js              # Documentation generator
│   │   └── vision.js           # Multimodal + TTS/STT agent
│   ├── rag/
│   │   ├── chunker.js          # Code-aware chunking (multi-language)
│   │   ├── indexer.js          # Codebase walker + batch indexer
│   │   └── store.js            # QVAC RAG wrapper
│   ├── tools/
│   │   ├── file-reader.js      # Read files with line ranges
│   │   ├── file-search.js      # Glob + grep search
│   │   ├── git-info.js         # Git operations (log, blame, diff)
│   │   └── tree.js             # Directory tree visualization
│   ├── p2p/
│   │   ├── provider.js         # P2P provider (serve to remote peers)
│   │   └── client.js           # P2P client (query remote DevBrain)
│   ├── security/
│   │   └── guard.js            # Prompt injection guard + path validation
│   ├── watcher/
│   │   └── monitor.js          # Real-time file change monitoring
│   └── finetune/
│       └── train.js            # LoRA fine-tuning pipeline
├── web/
│   ├── index.html              # Chat UI with performance dashboard
│   ├── style.css               # Dark theme responsive design
│   └── app.js                  # Frontend (streaming, multimodal, voice)
├── logs/                       # Inference logs (auto-generated)
├── apis.json                   # API disclosure (none — fully offline)
├── HARDWARE.md                 # Hardware specifications
├── package.json
└── LICENSE                     # Apache 2.0
```

---

## Inference Logging

Every operation is logged to `logs/inference-log.json`:

```json
{
  "timestamp": "2026-06-07T12:34:56.789Z",
  "sessionId": "session-1717753896789",
  "event": "inference",
  "modelId": "psy-4b-inst-q4km",
  "agent": "code",
  "prompt": "[code/explain_code] What does...",
  "tokensIn": 512,
  "tokensOut": 256,
  "ttft": 45,
  "tps": 32.5,
  "durationMs": 7890
}
```

---

## Security Features

- **Prompt Injection Detection** — Pattern matching against 15+ known injection vectors
- **System Prompt Hardening** — Immutable security directives appended to all agent prompts
- **Path Traversal Prevention** — Validates all file access stays within codebase
- **Output Filtering** — Redacts accidentally leaked credentials or system prompts
- **Input Sanitization** — Strips control characters, validates length limits
- **Audit Logging** — All security events logged for review

---

## Hardware Requirements

- **Minimum:** Apple Silicon Mac (M1+) or x86_64 with 16GB RAM
- **Recommended:** Apple Silicon Mac with 32GB RAM
- **Storage:** 10GB free (for models)
- **OS:** macOS 13+, Linux (with Metal/CUDA support)
- **Runtime:** Node.js 22.17+
- **Network:** None required (fully offline after first model download)

---

## Reproducibility

See [HARDWARE.md](./HARDWARE.md) for full hardware specifications and step-by-step reproduction instructions.

---

## License

Apache 2.0 — See [LICENSE](./LICENSE) for details.
