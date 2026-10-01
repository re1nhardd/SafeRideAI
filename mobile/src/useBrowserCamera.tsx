// Native fallback: Expo Go continues to use the Python inference server.
import type { ReactNode } from "react";
import { EMPTY } from "./useServer";
export function useBrowserCamera(_enabled: boolean) {
  return {
    status: EMPTY,
    phase: "",
    running: false,
    preview: null as ReactNode,
    restart: () => {},
    calibrationProgress: 0,
  };
}
