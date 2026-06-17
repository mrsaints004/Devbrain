# DevBrain v2.0

**The AI That Reviews Your Code Before You Push** — Proactive bug detection, security scanning, and code intelligence that runs 100% on your device. Zero cloud. Zero API bills. Zero data leaks.

> **Track:** General Purpose (16 GB RAM, Apple M2 Pro)
> **License:** Apache 2.0
> **Cloud Dependencies:** Zero. Fully air-gapped capable after first model download.
> **QVAC SDK:** All inference, embeddings, RAG, multimodal, TTS, STT, P2P, and fine-tuning powered by `@qvac/sdk`

---

## The Problem

Cloud-based code assistants require you to send your proprietary code to remote servers. DevBrain flips this: it watches your codebase in real-time and proactively detects bugs, security vulnerabilities, and performance issues **the moment you save a file** — all running locally on your machine.

## What Makes DevBrain Different

1. **Proactive, Not Reactive** — DevBrain doesn't wait for you to ask. It monitors file changes and automatically analyzes modified code for bugs, security issues, and performance problems. Issues appear in your chat as alerts before you even think to look.

2. **Multi-Agent Orchestration with Chaining** — Queries flow through a pipeline of specialized agents (Router, RAG, Code, Tool, Vision, Doc, Smell) that chain together. The Tool agent gathers live file context, the RAG agent finds related code, and the Code agent synthesizes a comprehensive answer.

3. **Re-ranked RAG** — Code-aware chunking splits by function/class boundaries with overlap. Initial retrieval pulls 12 candidates, then the LLM re-ranks to the top 5 most relevant chunks. This dramatically improves answer quality.

4. **P2P Delegated Inference** — Query your desktop's DevBrain from your phone via Holepunch DHT. No cloud relay — direct peer-to-peer.

5. **Complete Privacy** — No data leaves your device. Ever. All AI runs locally via QVAC SDK.

---

## Features

| Feature | Description | QVAC API |
|---|---|---|
| Proactive Code Smell Detection | Auto-analyzes files on save, surfaces bugs/security issues in real-time | `qvac.completion()` |
| Multi-Agent Pipeline | Router → RAG → Code/Tool/Doc/Vision agents with chaining | `qvac.completion()` |
| Code-Aware RAG with Re-ranking | Intelligent chunking + LLM re-ranking for precision | `qvac.ragIngest()`, `qvac.ragSearch()`, `qvac.embed()` |
| Multimodal Analysis | Analyze screenshots, architecture diagrams, code photos | `qvac.completion()` + image content |
| Voice Input/Output | STT via Whisper, TTS via Supertonic | `qvac.transcribe()`, `qvac.textToSpeech()` |
| P2P Delegated Inference | Query from phone/tablet via Holepunch DHT | `qvac.startQVACProvider()`, `qvac.connectToQVACProvider()` |
| Tool Calling | Agents autonomously read files, search code, query git | `qvac.completion()` with tools |
| Fine-Tuning | Generate LoRA adapters trained on your codebase | `qvac.finetune()` |
| Code Health Dashboard | Live score tracking: critical/warning/info issues over time | — |
| Security Hardening | Prompt injection detection, path traversal prevention, output filtering | — |
| Performance Metrics | Live tokens/sec, TTFT, query count, uptime | — |
| Streaming Responses | Token-by-token SSE streaming with animated agent pipeline | — |

---

## Architecture

```
User Query (text / image / voice)          File Save Event
         ↓                                       ↓
    Security Guard                          File Watcher (chokidar)
         ↓                                       ↓
    STT Agent (Whisper)                    Re-index changed files (RAG)
         ↓                                       ↓
    Router Agent (8 intents)               Smell Agent (LLM)
         ↓                                       ↓
    Orchestrator (multi-agent chaining)    SSE Push Alert → Code Health Score
    ├── RAG Agent (search + LLM re-rank)
    ├── Code Agent (analyze/explain/bug/refactor)
    ├── Tool Agent (file/git/tree ops)
    │   └── Results fed back to Code Agent ← chaining
    ├── Doc Agent (documentation gen)
    └── Vision Agent (Qwen3-VL multimodal)
         ↓
    Output Filter (credential redaction)
         ↓
    Streaming Response (SSE tokens)
```

### Agent Chaining Example

For a "find bugs" query:
1. **Router** classifies intent as `find_bug`
2. **RAG** retrieves 12 candidates, **Re-ranker** narrows to top 5
3. **Tool Agent** reads live file content to verify against RAG snapshots
4. **Code Agent** synthesizes a bug report using both RAG context and live file data
5. Result streams token-by-token to the frontend

---

## QVAC SDK Integration

| Capability | QVAC API | Purpose |
|---|---|---|
| LLM Inference | `qvac.completion()` | Multi-agent reasoning, intent classification, re-ranking, code analysis |
| Embeddings | `qvac.embed()` | Code-aware vector embeddings for RAG |
| RAG Ingest | `qvac.ragIngest()` | Index codebase chunks into vector store |
| RAG Search | `qvac.ragSearch()` | Semantic code retrieval |
| Multimodal | `qvac.completion()` + image content | Screenshot/diagram analysis (Qwen3-VL) |
| Text-to-Speech | `qvac.textToSpeech()` | Voice output (Supertonic) |
| Speech-to-Text | `qvac.transcribe()` | Voice input (Whisper) |
| P2P Provider | `qvac.startQVACProvider()` | Serve inference to remote peers |
| P2P Client | `qvac.connectToQVACProvider()` | Delegate queries to powerful device |
| Fine-tuning | `qvac.finetune()` | LoRA adapter training on codebase |
| Model Management | `qvac.loadModel()` / `unloadModel()` | Lifecycle management |

---

## Models

| Role | Model | Size |
|---|---|---|
| Primary LLM | Qwen3 4B Instruct Q4_K_M | ~2.6 GB |
| Embeddings | GTE-Large FP16 | ~0.7 GB |
| Vision | Qwen3-VL 2B Multimodal Q4_K | ~1.5 GB |
| STT | Whisper Base Q0F16 | ~150 MB |
| TTS | Supertonic (component-based) | ~500 MB |

**Peak memory:** ~5.8 GB (fits in 16 GB RAM)

---

## Quick Start

```bash
git clone https://github.com/AYANscyy2/devbrain.git
cd devbrain
npm install
npm test                                    # Run test suite (84 tests)
node src/index.js --path ./your-project --watch
open http://localhost:3000
```

### CLI Options

```
--path <dir>       Codebase directory to index (default: current dir)
--port <number>    HTTP server port (default: 3000)
--workspace <name> RAG workspace name (default: devbrain-default)
--watch            Enable real-time file monitoring + proactive smell detection
--no-p2p           Skip P2P provider startup
```

### P2P Client

```bash
node src/p2p/client.js --key <provider-public-key> --interactive
```

### Fine-tuning

```bash
node src/finetune/train.js --path ./your-project --epochs 3
```

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/query` | Send a query (blocking) |
| POST | `/api/query/stream` | Send a query (SSE streaming) |
| POST | `/api/index` | Trigger codebase re-indexing |
| GET | `/api/status` | Full system status + code health |
| GET | `/api/stats` | Session performance metrics |
| GET | `/api/logs` | Inference log entries |
| GET | `/api/events` | SSE stream of file changes + code smell alerts |
| POST | `/api/stt` | Speech-to-text transcription (Whisper) |
| POST | `/api/tts` | Text-to-speech synthesis (Supertonic) |
| POST | `/api/models/load` | Reload all models |

---

## Project Structure

```
DevBrain/
├── src/
│   ├── index.js                # Entry point with startup orchestration
│   ├── server.js               # Express HTTP + SSE streaming server
│   ├── models.js               # Multi-model loader (LLM, Vision, TTS, STT)
│   ├── logger.js               # Structured inference logging + session stats
│   ├── agents/
│   │   ├── orchestrator.js     # Multi-agent pipeline with chaining
│   │   ├── router.js           # Intent classifier (8 intents)
│   │   ├── rag.js              # Vector search + LLM re-ranking
│   │   ├── code.js             # Code analysis (explain, bug, refactor)
│   │   ├── tool.js             # Tool-calling agent (4 tools)
│   │   ├── doc.js              # Documentation generator
│   │   ├── vision.js           # Multimodal + TTS/STT agent
│   │   └── smell.js            # Proactive code smell detector
│   ├── rag/
│   │   ├── chunker.js          # Code-aware chunking with overlap
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
│   ├── index.html              # Chat UI with code health dashboard
│   ├── style.css               # Dark theme with agent-colored pipeline
│   └── app.js                  # Frontend (streaming, multimodal, voice)
├── test/
│   ├── router.test.js          # Intent classification tests (33 tests)
│   ├── chunker.test.js         # Code chunking tests (16 tests)
│   ├── security.test.js        # Security guard tests (30 tests)
│   └── rag.test.js             # RAG formatting tests (5 tests)
├── logs/                       # Inference logs (auto-generated)
├── remote-apis.json            # API disclosure (none — fully offline)
├── apis.json                   # QVAC SDK usage disclosure
├── HARDWARE.md                 # Hardware specs + reproduction instructions
├── package.json
└── LICENSE                     # Apache 2.0
```

---

## Security

- **Prompt Injection Detection** — 18+ pattern matching against known injection vectors
- **System Prompt Hardening** — Immutable security directives on all agent prompts
- **Path Traversal Prevention** — Validates all file access stays within codebase
- **Output Filtering** — Redacts accidentally leaked credentials, strips `<think>` tags
- **Input Sanitization** — Strips control characters, validates length limits (10 KB max)
- **Audit Logging** — All security events logged for review

---

## Testing

```bash
npm test          # Run all 84 tests
npm run test:router    # Intent classification (33 tests)
npm run test:chunker   # Code chunking (16 tests)
npm run test:security  # Security guard (30 tests)
npm run test:rag       # RAG formatting (5 tests)
```

---

## Hardware Requirements

- **Minimum:** Apple Silicon Mac (M1+) or x86_64 with 16 GB RAM
- **Recommended:** Apple Silicon Mac with 32 GB RAM
- **Storage:** 10 GB free (for models)
- **OS:** macOS 14+, Linux
- **Runtime:** Node.js 22+
- **Network:** None required (fully offline after first model download)

See [HARDWARE.md](./HARDWARE.md) for full specs and step-by-step reproduction.

---

## Inference Logging

Every operation is logged to `logs/inference-log.json` and `logs/inference-log.csv`:

```json
{
  "timestamp": "2026-06-07T12:34:56.789Z",
  "sessionId": "session-1717753896789",
  "event": "inference",
  "modelId": "qwen3-4b-inst-q4km",
  "agent": "code",
  "prompt": "[code/find_bug] Find bugs in...",
  "tokensIn": 512,
  "tokensOut": 256,
  "ttft": 120,
  "tps": 38.5,
  "durationMs": 6650
}
```

---

## License

Apache 2.0 — See [LICENSE](./LICENSE) for details.
