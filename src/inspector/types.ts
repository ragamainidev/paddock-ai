// Multi-modal pre-purchase inspection agent. Photos are the primary
// artifact: vision findings anchor to photo indices, research topics are
// derived from what the photos actually show, and every stage streams typed
// events so the UI can render the agent thinking. Nothing here is invented:
// findings come from the model looking at real photos, research comes from
// real web searches and the NHTSA API, market position from real listings.

// -- Input ------------------------------------------------------------------

// A photo is either a URL (listing photos, pasted links) fetched by the
// vision API, or an upload carried as base64 — uploads never touch disk.
export type PhotoSource =
  { kind: 'url'; url: string } | { kind: 'upload'; mediaType: UploadMediaType; data: string };

export type UploadMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export type InspectorInput = {
  photos: PhotoSource[];
  make: string;
  model: string;
  year: number;
  vin?: string;
  askingPrice?: number; // enables market position
  // Provenance and context when the car came from a live listing. The seller's
  // own words go to the vision pass so claims can be checked against photos.
  listing?: {
    title: string;
    url: string;
    source: string; // e.g. 'Bring a Trailer' — provenance shown in the UI
    condition?: string;
    description?: string;
  };
};

// -- Vision -----------------------------------------------------------------

export type PhotoAnalysis = {
  overallCondition: 'excellent' | 'good' | 'fair' | 'poor';
  // One short note per photo, in photo order — the visible part of the
  // model actually looking at each image.
  observations: PhotoObservation[];
  issues: DetectedIssue[];
  modifications: DetectedModification[];
  wear: WearPattern[];
  confidence: number; // 0-1
};

export type PhotoObservation = { photo: number; note: string };

export type DetectedIssue = {
  type: IssueType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  location?: string; // e.g. "front left wheel well"
  photos: number[]; // indices into input.photos — validated, never out of range
};

export type IssueType =
  | 'body_damage'
  | 'rust'
  | 'paint_issue'
  | 'fluid_leak'
  | 'tire_wear'
  | 'glass_damage'
  | 'lighting_issue'
  | 'undercarriage_issue'
  | 'interior_wear'
  | 'frame_damage';

export type DetectedModification = {
  type: ModificationType;
  description: string;
  quality: 'oem' | 'quality_aftermarket' | 'budget_aftermarket' | 'unknown';
  photos: number[];
};

export type ModificationType =
  | 'exhaust'
  | 'suspension'
  | 'wheels'
  | 'body_kit'
  | 'engine_mods'
  | 'brakes'
  | 'intake'
  | 'ecu_tune'
  | 'interior_mods';

export type WearPattern = {
  component: string;
  level: 'minimal' | 'moderate' | 'significant';
  description: string;
};

// -- Research ---------------------------------------------------------------

// What the agent decided to research and why. Derived deterministically from
// the vision findings + known-failure data, so the decisions are testable.
export type ResearchTopic = {
  topic: string;
  reason: string; // shown in the console: the agent explains itself
  priority: number; // higher first
  area?: string; // ties a cost topic back to the repair-plan task it prices
};

// A finding from real web research. Findings without at least one source URL
// are discarded during validation — no uncited claims.
export type WebFinding = {
  topic: string;
  summary: string;
  severity: 'info' | 'concern' | 'critical';
  sources: { url: string; title: string }[];
  costEstimate?: string; // verbatim from research, e.g. "$2,500–4,000"
};

// A prior appearance of this exact VIN somewhere public — an earlier
// listing, an auction result, a forum build thread. Every sighting must
// carry its source URL or it is discarded (SPEC 22 applies to provenance
// exactly as it does to research).
export type VinSighting = {
  url: string;
  title: string;
  source: string; // hostname, derived
  date?: string; // as the source states it, verbatim
  note?: string; // what it said: price, mileage, outcome
};

// NHTSA complaints/recalls narrowed to what the photos showed. Counts are
// computed from the data, never model-written.
export type NhtsaResearch = {
  complaintsTotal: number;
  topComponents: { component: string; count: number }[];
  recalls: { campaign: string; component: string; summary: string }[];
  // detected issue types that have matching federal complaint volume
  matchedIssues: { issueType: IssueType; component: string; count: number }[];
};

export type ReliabilityReport = {
  modelConcerns: ModelConcern[];
  commonFailures: CommonFailure[];
  overallReliability: 'excellent' | 'good' | 'fair' | 'poor';
};

export type ModelConcern = {
  component: string;
  description: string;
  affectedYears: number[];
  frequency: 'rare' | 'uncommon' | 'common' | 'very_common';
};

export type CommonFailure = {
  component: string;
  failureDescription: string;
  typicalMileage: number;
  repairCost: 'low' | 'medium' | 'high';
};

// -- VIN --------------------------------------------------------------------

// Honest scope: structural decode always, the federal vPIC decode when
// reachable, plus claimed-vs-decoded mismatch flags. No history verdict —
// we do not query title/theft databases, so we never print "clean"; the
// links hand the buyer the services that DO check history.
export type VinCheck = {
  vin: string;
  valid: boolean;
  decoded?: {
    country?: string;
    make?: string;
    model?: string; // vPIC only
    year?: number; // vPIC, else best cycle candidate nearest the claimed year
    trim?: string; // vPIC only
    bodyClass?: string; // vPIC only
    engine?: string; // vPIC only, e.g. "3.2L 6cyl"
    plant?: string; // vPIC only, e.g. "Regensburg, Germany"
    wmi: string; // world manufacturer identifier, first 3 chars
    serial: string; // last 6
  };
  mismatches: string[]; // e.g. "VIN decodes to Honda; listing claims BMW"
  note: string; // what was NOT checked, stated plainly
  // History services for the buyer, pre-filled with this VIN. We link, we
  // never claim to have checked (SPEC 26).
  links: { label: string; url: string }[];
};

// -- Market -----------------------------------------------------------------

export type MarketComp = { title: string; price: number; url: string };

export type MarketPosition = {
  sampleSize: number;
  low: number;
  median: number;
  high: number;
  asking?: number;
  position?: 'below' | 'at' | 'above'; // vs median, ±5% band is "at"
  delta?: number; // asking - median, dollars
  repairExposure: { low: number; high: number; drivers: string[] };
  query: string; // the comps query, shown for provenance
  comps: MarketComp[]; // top comps for display
};

// -- Stages and events ------------------------------------------------------

export type InspectStage =
  'photos' | 'vision' | 'plan' | 'reliability' | 'nhtsa' | 'web' | 'vin' | 'market' | 'synthesis';

export type InspectStageStatus = {
  stage: InspectStage;
  ok: boolean;
  detail?: string; // rendered as one meta line when degraded
};

// The event stream the orchestrator yields and the API forwards as NDJSON.
// The console renders these in order; the report event is always last on a
// successful run, and every degraded stage emits a visible status first.
// `begin` marks a stage going active (drives the UI's stage rail); `span`
// carries trace timings and rides the same stream so traces persist with
// the run and render live.
export type InspectEvent =
  | { type: 'begin'; stage: InspectStage }
  | { type: 'span'; span: import('@/trace/tracer').Span }
  | { type: 'stage'; status: InspectStageStatus }
  | { type: 'thought'; stage: InspectStage; text: string }
  | { type: 'photo'; index: number; note: string }
  | { type: 'analysis'; analysis: PhotoAnalysis }
  | { type: 'plan'; topics: ResearchTopic[] }
  | { type: 'web'; finding: WebFinding }
  | { type: 'sightings'; sightings: VinSighting[] }
  | { type: 'nhtsa'; research: NhtsaResearch }
  | { type: 'reliability'; report: ReliabilityReport }
  | { type: 'vin'; check: VinCheck }
  | { type: 'market'; market: MarketPosition }
  | { type: 'report'; report: InspectorReport }
  | { type: 'fatal'; message: string };

// -- Report -----------------------------------------------------------------

export type OverallAssessment = {
  verdict: 'pass' | 'caution' | 'avoid';
  confidence: number;
  summary: string;
  keyFindings: string[];
  redFlags: string[];
  recommendedChecks: string[];
};

// The report never echoes photo bytes back — uploads can be megabytes and
// the client already holds them. `photoCount` is enough to validate anchors.
export type InspectorReport = {
  vehicle: { make: string; model: string; year: number };
  photoCount: number;
  vin?: string;
  askingPrice?: number;
  listing?: InspectorInput['listing'];
  analysis: PhotoAnalysis;
  topics: ResearchTopic[];
  web: WebFinding[];
  sightings: VinSighting[];
  nhtsa?: NhtsaResearch;
  reliability: ReliabilityReport;
  vinCheck?: VinCheck;
  market?: MarketPosition;
  assessment: OverallAssessment;
  stages: InspectStageStatus[];
  generatedAt: string;
};
