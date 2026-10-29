// Bridge for saving/restoring the camera with a project (set by the CameraRig).
import type { CameraData } from "../core/projectFile";

export const cameraState: { get: (() => CameraData | undefined) | null; set: ((c: CameraData) => void) | null } = { get: null, set: null };
