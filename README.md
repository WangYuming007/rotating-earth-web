# Rotating Earth Web

精美的 3D 旋转地球网页，包含：
- 地球白天纹理
- 夜景灯光（暗面发光）
- 云层漂移
- 大气光晕
- 星空背景
- 拖拽旋转与滚轮缩放

## 在线访问
- GitHub 仓库：<https://github.com/WangYuming007/rotating-earth-web>
- GitHub Pages（部署后）：<https://wangyuming007.github.io/rotating-earth-web/>

## 本地预览
在项目目录运行：

```bash
python3 -m http.server 5173
```

然后打开：
<http://localhost:5173>

## 自动部署说明
仓库已配置 GitHub Actions：
- 工作流文件：`.github/workflows/deploy-pages.yml`
- 触发条件：push 到 `main` 分支
- 发布方式：自动部署到 GitHub Pages

首次启用时，如果 Actions 提示未启用 Pages，请在仓库设置中确认：
- `Settings` -> `Pages` -> `Build and deployment` -> `Source` 选择 `GitHub Actions`
