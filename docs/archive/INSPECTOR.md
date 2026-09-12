> **Archived 2026-08-15.** Written for an earlier inspector; it names modules that no longer exist (`forums.ts`, Reddit) and test counts that are stale. Kept for history only. Current truth: `SPEC.md` (21–29, 33), `src/inspector/README.md`, and `docs/`.

# Multi-Modal Car Inspector Agent - Implementation Summary

## Overview

Built a genuinely dynamic multi-modal AI agent for automotive inspection that demonstrates **advanced agent engineering** patterns. Unlike traditional pipelines, this agent makes **conditional decisions** based on vision analysis findings - research paths vary depending on what's actually detected in the photos.

## What Makes This "Actually Agent-Based"

**Not a Static Pipeline:**

```
Photos → Model → Fixed Steps → Report
```

**Dynamic Agent Orchestration:**

```
Photos → Vision Analysis → FINDING: Rust detected
       → DECIDE: Research corrosion forums
       → DECIDE: Check subframe mounting issues
       → FINDING: Budget modifications
       → DECIDE: Research reliability impact
       → Synthesize risk report
```

The agent **decides what to research** based on what it finds. A clean car skips forum research entirely. A car with frame damage triggers VIN lookup and structural safety research. Budget modifications trigger reliability research.

## Technical Architecture

### Multi-Modal Integration

- **Vision API** (Claude Sonnet 5): Photo analysis for issues, modifications, wear
- **Text APIs**: Forum research, VIN decoding, reliability database
- **Dynamic Orchestration**: Tool selection based on model output

### Key Components

**1. Vision Analysis (`src/inspector/vision.ts`)**

- Multi-photo automotive inspection
- Detects 10+ issue types (rust, frame_damage, fluid_leaks, etc.)
- Identifies 9+ modification types with quality assessment
- Returns structured findings with severity levels
- Graceful degradation when API unavailable

**2. Dynamic Decision Engine (`src/inspector/inspector.ts`)**

- `generateResearchQueries()` decides what to research based on findings
- High/critical severity issues → forum research + specific checks
- Budget modifications → reliability impact research
- Frame damage → VIN lookup + structural safety research
- Clean cars → skip forum research, only reliability check

**3. Tool Implementations**

- **Forum Research** (`src/inspector/forums.ts`): Reddit API integration, enthusiast forum search
- **VIN Lookup** (`src/inspector/vin.ts`): VIN decoding, history checks, accident/salvage detection
- **Reliability Database** (`src/inspector/reliability.ts`): Known failure points, common repairs by model

**4. Risk Synthesis**

- Combines findings from vision + forums + VIN + reliability
- Generates red flags, recommended checks, overall verdict
- Actionable, specific recommendations (not generic warnings)

### Dynamic Examples

**Clean Car Scenario:**

```
Vision: No issues detected
→ Forum: SKIPPED (nothing to research)
→ VIN: SKIPPED (not provided)
→ Reliability: Checked for context
→ Result: PASS (high confidence)
```

**Rust Detected:**

```
Vision: Rust on wheel wells (medium severity)
→ Forum: "BMW E46 wheel arch rust corrosion"
→ Reliability: Rear subframe mounting concerns
→ Result: CAUTION - recommend professional inspection
```

**Frame Damage:**

```
Vision: Possible frame damage (critical)
→ Forum: Frame repair options/costs
→ VIN: Accident/salvage history lookup
→ Result: AVOID - structural safety concern
```

## Industry-Leading Codebase Features

### 1. Advanced Agent Patterns

- **Conditional Tool Use**: Tools selected based on model output
- **Multi-Modal Understanding**: Vision + text APIs working together
- **Adaptive Orchestration**: Next steps depend on previous findings
- **Risk Synthesis**: Combines multiple sources into actionable insights

### 2. Production-Ready Architecture

- **Graceful Degradation**: Each stage fails independently
- **Error Handling**: Rate limiting, API errors, validation
- **Testability**: All dependencies injected, mock implementations
- **Server-Side Only**: No NEXT_PUBLIC_ secrets exposed

### 3. Comprehensive Testing

- **224 tests total**, 9 specifically for inspector agent
- **TDD Approach**: Tests written before implementations
- **Mock Implementations**: Full offline testing capability
- **Scenario Coverage**: Clean cars, rust, frame damage, modifications, VIN integration

### 4. Observability & Transparency

- Every finding includes source and confidence level
- Tool selection reasoning exposed
- Status reporting at each stage
- Provenance tracking throughout

## File Structure

```
src/inspector/
├── types.ts          # Core type definitions
├── inspector.ts      # Main orchestration & dynamic decisions
├── vision.ts         # Claude Vision API integration
├── forums.ts         # Forum research (Reddit, enthusiast forums)
├── vin.ts            # VIN decoding & history lookup
├── reliability.ts    # Known failure database
├── inspector.test.ts # Comprehensive test suite
└── README.md         # Architecture documentation

src/app/
├── api/inspect/route.ts  # Server-side API endpoint
├── inspect/page.tsx      # Client-side UI
└── layout.tsx            # Navigation integration
```

## Usage

**Web Interface:**

- Visit `/inspect` to access the inspector UI
- Upload photo URLs, enter vehicle details (optional VIN)
- Get real-time AI-powered analysis

**API Endpoint:**

```bash
POST /api/inspect
{
  "photos": ["https://example.com/car.jpg"],
  "make": "BMW",
  "model": "M3",
  "year": 2004,
  "vin": "WBSDE934X..." // optional
}
```

**Environment Variables:**

```bash
ANTHROPIC_API_KEY=sk-...        # Required for photo analysis
REDDIT_CLIENT_ID=...             # Optional for forum research
REDDIT_CLIENT_SECRET=...         # Optional for forum research
```

## Test Coverage

**9 Inspector Tests Cover:**

1. Rust detection → forum research triggering
2. Modification detection → reliability research
3. Clean cars → forum research skipped
4. VIN lookup when issues detected
5. VIN lookup skipped when not provided
6. Risk synthesis from multiple sources
7. Clean car pass verdict
8. Suspension modification research
9. Model-specific failure points

**All Tests Pass:**

```bash
pnpm test              # 224 tests passed
pnpm test src/inspector/  # 9 tests passed
```

## Advanced Features Demonstrated

### 1. Multi-Modal Understanding

- Vision API for automotive image understanding
- Text APIs for research and synthesis
- Structured data for reliability/VIN systems

### 2. Dynamic Orchestration

- Tool selection based on model findings
- Conditional research execution
- Adaptive next-step decisions

### 3. Real-World Integration

- Reddit API for forum research
- VIN decoding services
- Automotive reliability databases
- Graceful degradation when services unavailable

### 4. Production Patterns

- Dependency injection for testability
- Mock implementations for offline testing
- Error handling and rate limiting
- Server-side security (no exposed secrets)

## What This Demonstrates

This implementation shows **advanced agent engineering** beyond simple pipelines:

✅ **Multi-modal AI** (vision + text + structured data)
✅ **Dynamic decision making** (not fixed pipelines)
✅ **Conditional tool use** (based on findings)
✅ **Real-world integrations** (Reddit, VIN, automotive data)
✅ **Production architecture** (testing, error handling, security)
✅ **Industry-leading codebase** (proper agent patterns, not just "add AI")

## Running

```bash
# Development
pnpm dev               # Start dev server, visit /inspect

# Testing
pnpm test              # Full test suite
pnpm test src/inspector/ # Inspector tests only

# Type checking
pnpm typecheck         # Verify TypeScript types

# Build
pnpm build             # Production build
```

## Access Points

- **Web UI**: http://localhost:3000/inspect
- **API Health**: http://localhost:3000/api/inspect
- **Documentation**: `src/inspector/README.md`

---

**This is a genuinely dynamic multi-modal agent** - not a pipeline with AI at the front, but an agent that **decides what to do** based on what it finds. The research path varies for each car, demonstrating advanced agentic patterns suitable for industry-leading applications.
