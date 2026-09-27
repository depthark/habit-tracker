/**
 * Ambient declarations for the build tooling.
 *
 * `astro check` used to supply these. With TypeScript 7 the check runs through
 * `tsc` and the content mapper, so the pieces Astro would normally inject are
 * declared here instead.
 *
 * Note: `include` in tsconfig.json deliberately omits `.astro/types.d.ts`.
 * That file references `astro/client`, which drags Astro's own shipped <Font>
 * and <Picture> components into the program; they reference a virtual module
 * that only exists inside the Astro build, so a standalone `tsc` can never
 * resolve them. The trade is that the ambient Astro globals are gone, and what
 * this project actually uses — `import.meta.env` and the stylesheet import — is
 * declared below.
 */

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly SSR: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.css';
