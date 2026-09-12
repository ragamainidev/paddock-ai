import type { InspectorCaseResult } from './inspector/suite';

// The committed eval artifact's shape — shared by the runner (which writes
// results.json) and the /evals page (which renders it). Side-effect free so
// the page can import types without executing the runner.

export type ResolverRow = {
  n: number;
  query: string;
  expectation: string;
  pass: boolean;
  detail?: string;
};

export type EvalArtifact = {
  date: string;
  gitSha: string;
  mode: string;
  suites: {
    resolver: {
      pipeline: string;
      passed: number;
      total: number;
      rows: ResolverRow[];
    };
    inspector: {
      pipeline: string;
      casesPassed: number;
      casesTotal: number;
      checksPassed: number;
      checksTotal: number;
      byClass: Record<string, { passed: number; total: number }>;
      cases: InspectorCaseResult[];
    };
    salvage?: {
      pipeline: string;
      casesPassed: number;
      casesTotal: number;
      checksPassed: number;
      checksTotal: number;
      byClass: Record<string, { passed: number; total: number }>;
      cases: InspectorCaseResult[];
    };
  };
};

/** One committed line per eval run; the /evals page renders the trend. */
export type HistoryEntry = {
  date: string;
  gitSha: string;
  mode: string;
  resolver: { passed: number; total: number };
  inspector: { checksPassed: number; checksTotal: number };
  salvage?: { checksPassed: number; checksTotal: number };
};
