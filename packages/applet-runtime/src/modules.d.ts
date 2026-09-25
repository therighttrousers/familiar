// The applet's entry point, aliased by vite.config.ts.
declare module "@applet/main" {
  import type { ComponentType } from "react";

  const Applet: ComponentType;
  export default Applet;
}
