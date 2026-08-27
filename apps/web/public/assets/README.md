# Reso.AI assets

放置已确认来源和授权的插画、地图、岛屿、角色与纹理资源。新增资产必须记录来源，页面只引用本目录内经过确认和优化的正式资源。

## Reso Agent v1

`reso-agent/` 内的五张 WebP 是 2026-08-27 为当前产品闭环生成的原创角色素材，使用 Codex 内置 `imagegen` 工具生成并经过透明通道检查与 WebP 优化。它们不包含外部品牌、文字、Logo 或水印。

| 文件             | 页面用途         | 姿态                 |
| ---------------- | ---------------- | -------------------- |
| `welcome.webp`   | Welcome          | 挥手迎接             |
| `birth.webp`     | Agent Birth      | 在柔和光轨中漂浮诞生 |
| `companion.webp` | Agent Chat       | 坐着倾听和思考       |
| `memory.webp`    | Persona / Memory | 双手托着发光记忆体   |
| `guardian.webp`  | Email Claim      | 持柔和透明护盾       |

### 角色锁定描述

所有姿态使用同一角色：pearl-white 圆润身体、deep-indigo 面屏、lavender 发光眼睛、violet 围巾及 peach 色内衬；材质为温暖、柔和、精致的 3D 绘本式渲染。脸、身体比例、材质、围巾和色彩保持一致。

### 最终提示词

共同约束：`transparent background; same Reso Agent identity and proportions; no text, logo, watermark, complex background or additional objects; preserve soft luminous edges as real RGBA transparency`。

- Welcome：`the Reso Agent standing and waving hello, welcoming, open posture, warm gentle expression`。
- Birth：`the Reso Agent floating weightlessly at birth, arms open, restrained violet light trails around the body`。
- Companion：`the Reso Agent sitting comfortably, one hand supporting its cheek, listening and thinking`。
- Memory：`the Reso Agent carefully holding a small glowing lavender memory orb in both hands`。
- Guardian：`the Reso Agent standing calmly with a soft translucent lavender privacy shield`。

三张生成器曾输出可见棋盘格的源图，正式 WebP 使用边缘连通分离清除了背景；Birth 另外通过 `background-extraction` 编辑重新取得真实透明通道。原始生成文件保留在 Codex 生成目录，不纳入仓库。
