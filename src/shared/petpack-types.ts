/** Versioned data model shared by the Pet Library, editor and desktop engine. */
interface PetDefinition {
  schemaVersion: 1;
  id: string;
  displayName: string;
  description?: string;
  author?: string;
  version?: string;
  homepage?: string;
  license?: { name: string; url?: string };
  assets: { spritesheet: string; icon?: string; preview?: string };
  sprite: {
    frameWidth: number;
    frameHeight: number;
    columns: number;
    rows: number;
    scale: number;
    anchorX?: number;
    anchorY?: number;
  };
  animations: Record<string, PetPackAnimation>;
  behaviours?: Record<string, PetPackBehaviour>;
  interactions?: Partial<Record<'click' | 'doubleClick' | 'rightClick' | 'dragStart' | 'dragEnd' | 'hover' | 'drop', { animation?: string; animations?: string[] }>>;
  ai?: { emotionMap?: Record<string, string> };
  aliases?: Record<string, string>;
  needsConfiguration?: boolean;
  source: 'builtin' | 'imported';
  installPath?: string;
}

interface PetPackAnimation {
  frames: number[];
  fps: number;
  loop: boolean;
  flipX?: boolean;
  flipY?: boolean;
  returnTo?: string;
}

interface PetPackBehaviour {
  animation: string;
  weight: number;
  speed?: number;
  cooldownMs?: number;
  minDurationMs?: number;
  maxDurationMs?: number;
  priority?: number;
}
