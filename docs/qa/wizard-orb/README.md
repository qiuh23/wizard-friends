# 水晶球蓝光与局部暖光

2026-11-12，基于 `main` 的 `da8b9f7`（已合并 Blender 牌桌 PR #40）。
用户认可的 Blender 图是美术参考，不是本次游戏运行截图。本分支仅供 PR 评审，不合并或部署。

## 实现

- 保留原 GLB 球体和底座，运行时把不透明玉色材质改为半透明水晶壳；壳内是柔和蓝白核心，外侧仅有很弱的蓝色光晕。微弱呼吸使用原场景时钟，暂停冻结，减少动态偏好下静止。
- 采用 alpha 透明壳和小尺寸径向纹理，没有全屏 bloom、物理折射/透射额外渲染、阴影贴图或新的动画循环。透明壳仍有真实灯光高光，但不承诺与 Blender 光线追踪相同的折射效果。
- 桌面球体增加短距离蓝色点光，提灯采用包内原 `wizard_rune_lantern.glb`，位于右后烛台旁，玻璃变为暖色自发光。两者替代两支次要蜡烛的点光预算；四支蜡烛视觉仍保留，两侧主蜡烛继续照亮周围。
- 桌面最多 4 点光、7 总灯；手机/紧凑/低画质仍最多 2 点光、4 总灯。小屏隐藏提灯并关闭球的真实点光，但保留核心和一小块桌面蓝色光晕。光晕固定 Y=.356，低于 Y=.382 的牌面；极窄横屏沿用原本隐藏装饰球的规则。
- 不调整环境光、曝光、卡牌材质、规则、布局或服务端。球壳、核心、纹理、提灯克隆材质拥有明确释放路径，恢复缓存素材材质，不销毁 Three 的共享 Sprite 几何。
- 原 16 GLB 文件不变；运行时多加载一件 25,736 字节的提灯，总共 11 件。额外径向纹理为 64×64 RGBA，约 16 KiB 原始像素，共用一次。

## 已完成验证

- `npm run check`：语法及严格 TypeScript 通过。
- `npm test`：373/373 通过。
- 三个灯光/素材/水晶球专项文件：17/17 通过，使用真实 Three 和 GLTFLoader 解析；覆盖点光预算、变换、隐藏/脱离、暂停/减动、回退重试、晚到加载和资源释放。Node 纹理解码仍使用原有测试替身，不代表 WebGL 验证。
- `SITE_EDITION=global npm run build` 和 `SITE_EDITION=cn npm run build`：通过；Vite 仍报告既有大场景 chunk 提示。
- `XDG_CONFIG_HOME=/tmp/wizard-orb-wrangler WRANGLER_SEND_METRICS=false npm run worker:check`：global 产物及 Worker dry-run 通过，没有发布。
- `git diff --check`：通过。

## 未完成的浏览器验收

本执行器启动 `/usr/bin/chromium` 在页面建立前失败：`socket() failed: Operation not permitted`。
因此**没有实机截图、WebGL 编译/渲染通过证明、手机帧率或最终视觉验收**；不把离线图称为实机效果。

已扩展原 `scripts/wizard-assets-review.mjs` 检查水晶壳、内核、实际光源位置、手机隐藏、灯数及重复切换资源，保留原卡面/布局/失败重试断言。
在可启动浏览器的环境运行 `npm run dev` 与原本地后端后：

```sh
GAME_URL=http://127.0.0.1:5173/ BROWSER_EXECUTABLE=/usr/bin/chromium npm run test:assets
```

需要实际审查透明层排序和暖色高光、桌面/竖横屏装饰不遮牌、转屏与高低画质重复切换、后台/暂停/减动和真实手机性能；当前结果不能作为可直接合并的视觉确认。
