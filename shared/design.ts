// What a design request and its results look like, shared by the Claude designer and the offline quick-builder.
import type { InventoryItem, Placement, Shapes } from './build.ts';

export type DesignSize = 'small' | 'medium' | 'large';

export interface DesignRequest {
  prompt: string;
  inventory: InventoryItem[];
  size: DesignSize;
}

export interface DesignResult {
  name: string;
  description: string;
  parts: Placement[];
  /** True when the validator had to drop parts to make the final build sound. */
  repaired: boolean;
  engine: 'claude' | 'openai' | 'quick';
}

export type DesignEvent =
  | { type: 'status'; message: string }
  | { type: 'note'; text: string }
  | { type: 'draft'; round: number; parts: Placement[]; issues: number }
  /** The connection to the model was lost (the app was left, the screen locked, the network dropped): waiting to carry on. */
  | { type: 'paused'; reason: 'away' | 'offline' }
  /** Carrying on: the round that was interrupted starts again. */
  | { type: 'resumed' }
  | { type: 'done'; design: DesignResult }
  | { type: 'error'; message: string };

/** The slice of the catalog a designer needs. */
export interface DesignCatalog {
  shapes: Shapes;
  colorNames: Record<number, string>;
  /** Printed or patterned part -> the plain part it is a decoration of. */
  printOf: Record<string, string>;
  /** Interchangeable molds of the same part. */
  variants: Record<string, string[]>;
}
