import './commands/index.js';

import type { EdgelessRootService } from './edgeless/edgeless-root-service.js';
import type { PageRootService } from './page/page-root-service.js';
import type { RootBlockModel } from './root-model.js';

export { FramePreview } from './edgeless/components/frame/frame-preview.js';
export { createButtonPopper } from './edgeless/components/utils.js';
export * from './edgeless/edgeless-root-block.js';
export { EdgelessRootService } from './edgeless/edgeless-root-service.js';
export { EdgelessBlockModel as EdgelessBlock } from './edgeless/type.js';
export { Viewport } from './edgeless/utils/viewport.js';
export * from './page/page-root-block.js';
export { PageRootService } from './page/page-root-service.js';
export { getAllowSelectedBlocks } from './page/utils.js';
export { type RootBlockModel, RootBlockSchema } from './root-model.js';
export { RootService } from './root-service.js';
export * from './types.js';
export * from './utils/index.js';
export * from './widgets/index.js';

declare global {
  namespace BlockSuite {
    interface BlockModels {
      'affine:page': RootBlockModel;
    }
    interface BlockServices {
      'affine:page': PageRootService | EdgelessRootService;
    }
  }
}
