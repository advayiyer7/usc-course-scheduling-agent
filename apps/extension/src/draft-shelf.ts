import {
  MAX_SCHEDULE_DRAFTS,
  type Proposal,
} from "../../../packages/contracts/src/companion.js";

/** A proposal belongs to one submitted request and one unchanged planner context. */
export class DraftShelf {
  private contextKey = "";
  private generationId: string | undefined;
  private drafts: Proposal[] = [];
  setContext(key: string) {
    if (this.contextKey === key) return false;
    this.contextKey = key;
    this.clear();
    return true;
  }
  clear() {
    this.generationId = undefined;
    this.drafts = [];
  }
  begin(generationId: string, key: string) {
    this.contextKey = key;
    this.clear();
    this.generationId = generationId;
  }
  accept(generationId: string | undefined, draft: Proposal) {
    if (!generationId || generationId !== this.generationId) return undefined;
    const existing = this.drafts.findIndex((d) => d.id === draft.id);
    if (existing !== -1)
      this.drafts = this.drafts.map((d, i) => (i === existing ? draft : d));
    else if (this.drafts.length < MAX_SCHEDULE_DRAFTS)
      this.drafts = [...this.drafts, draft];
    else return undefined;
    return this.drafts;
  }
  finish(generationId: string | undefined) {
    if (generationId && generationId === this.generationId)
      this.generationId = undefined;
  }
}
