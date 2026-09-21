// Intake Jev questions (pure definition, no OpenCode imports).
//
// Single Jev call with six structured questions. Jev never generates free
// text; the primary AndMar model owns reasoning and Internal Task Brief
// generation when refinement is required.

export type JevQuestionType = "choice" | "noul" | "score";

export interface JevChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

export interface JevNoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
}

export interface JevScoreQuestion {
  type: "score";
  instructions: string;
  criteria: string[];
}

export type JevQuestion = JevChoiceQuestion | JevNoulQuestion | JevScoreQuestion;

export const INTAKE_QUESTION_IDS = [
  "task_kind",
  "needs_refinement",
  "specification_sufficiency",
  "risk",
  "external_contract",
  "product_decision_missing",
] as const;

export type IntakeQuestionId = (typeof INTAKE_QUESTION_IDS)[number];

export const INTAKE_QUESTIONS: Record<IntakeQuestionId, JevQuestion> = {
  task_kind: {
    type: "choice",
    instructions: "What kind of development work does this request describe? Choose the closest category.",
    criteria: {
      "trivial-ui": "Tiny UI/text change: button label, wording, translation, typo, color, spacing. No logic change.",
      "docs-format": "Documentation, comments, formatting, markdown, lint style. No behavior change.",
      "known-test": "Fix a known failing test or add a straightforward test for specified behavior.",
      "feature": "Bounded new feature with reasonably clear scope: add validation, endpoint, component, command.",
      "bugfix": "Fix broken behavior with a known symptom and a plausible bounded fix.",
      "refactor": "Restructure code without changing behavior: rename, extract, move, clean up.",
      "debug": "Unclear failure needing investigation: vague symptom, race, flaky test, unknown root cause.",
      "architecture": "Architecture, design trade-offs, module boundaries, patterns spanning many files.",
      "security": "Security-sensitive: auth, permissions, secrets, tokens, forgery, injection, receipts trust.",
      "migration": "Migration or port across versions/platforms: OpenCode v2, framework upgrade, compatibility.",
      "review": "Review existing code or design and report findings without changing it.",
      "internal": "Internal tooling, config, chores, or anything that fits no other category.",
    },
  },
  needs_refinement: {
    type: "noul",
    instructions: "Does this request need internal refinement before execution? Answer true when intent, scope, acceptance criteria, or constraints are too vague to execute with consistent quality.",
    criteria: {
      true: "Intent, scope, acceptance criteria, or constraints are missing or too vague; a senior developer would need to guess.",
      false: "The request is precise enough to execute directly: intent and done-criteria are clear from the text alone.",
    },
  },
  specification_sufficiency: {
    type: "score",
    instructions: "How sufficient is the specification in the request for execution without guessing?",
    criteria: [
      "Empty or content-free: no actionable intent.",
      "Goal only: what is wanted but no scope, context, or acceptance criteria.",
      "Goal plus partial context: some scope or example but key details must still be guessed.",
      "Clear intent with implied acceptance: a competent developer could execute with minor repo checks.",
      "Fully specified: intent, scope, constraints, and done-criteria are explicit.",
    ],
  },
  risk: {
    type: "score",
    instructions: "What is the risk if this request is executed incorrectly or with wrong assumptions?",
    criteria: [
      "Low: cosmetic or easily reversible change, no data, auth, or external impact.",
      "Medium: bounded behavior change; mistakes are visible and fixable with tests.",
      "High: broad, hard-to-reverse, or trust-sensitive change: security, data, migration, external side effects.",
      "Critical: irreversible, production, secrets, or integrity-critical change where a mistake is severe.",
    ],
  },
  external_contract: {
    type: "noul",
    instructions: "Does execution depend on an external contract outside this repo: upstream API, migration compatibility, auth provider, payment, webhook, runtime boundary?",
    criteria: {
      true: "Correctness depends on an upstream API, migration guide, external provider, or runtime boundary outside the repo.",
      false: "The work is self-contained in the repo; no upstream or external contract determines correctness.",
    },
  },
  product_decision_missing: {
    type: "noul",
    instructions: "Is a real product decision missing that cannot be resolved responsibly from repo context and must be asked to the user?",
    criteria: {
      true: "A genuine product choice (scope, behavior, UX, priority) is absent and cannot be inferred from repo, docs, or code.",
      false: "No product decision is missing, or any open point can be resolved from repo context without asking the user.",
    },
  },
};
