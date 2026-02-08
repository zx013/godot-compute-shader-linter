# Godot Compute Shader Linter

用于 Godot 计算着色器的 VS Code 扩展，基于 glslangValidator 提供实时的 GLSL 代码检查功能。

## 功能特性

- 支持 GLSL 语法检查
- 自动识别 Godot Shader 格式（`#[compute]`）
- 支持递归处理 `#include` 文件
- 在打开或保存文件时自动进行 lint 检查
- 支持多种着色器类型：顶点着色器（vert）、片段着色器（frag）、计算着色器（comp）等

## 安装要求

在使用此扩展之前，您需要安装 [glslangValidator](https://github.com/KhronosGroup/glslang)：

### Windows

1. 从 [glslang GitHub Releases](https://github.com/KhronosGroup/glslang/releases) 下载最新版本的 Windows 二进制文件
2. 解压文件
3. 将 `glslangValidator.exe` 所在的路径添加到系统 PATH 环境变量中，或者记下完整路径用于配置

### macOS

```bash
brew install glslang
```

### Linux

```bash
sudo apt-get install glslang-tools
# 或者
sudo yum install glslang-tools
```

## 配置

扩展支持自动回退机制，因此配置是**可选的**：

- **validatorPath**: 如果未配置，会自动使用扩展安装目录下的：
  - Windows: `bin/glslangValidator.exe`
  - Linux/macOS: `bin/glslangValidator`
- **fileExtensions**: 如果未配置，会自动使用 `{ ".comp.glsl": "comp" }`

**重要说明**: `bin` 目录会被打包到扩展中，因此用户无需额外配置即可使用。

打开 VS Code 设置（`Ctrl+,` 或 `Cmd+,`），搜索 `godot-compute-shader-linter` 进行配置，或者直接在 `settings.json` 中添加：

```json
{
  "godot-compute-shader-linter.validatorPath": "glslangValidator",
  "godot-compute-shader-linter.validatorArgs": [],
  "godot-compute-shader-linter.fileExtensions": {
    ".vert.glsl": "vert",
    ".vert": "vert",
    ".frag.glsl": "frag",
    ".frag": "frag",
    ".comp.glsl": "comp",
    ".comp": "comp"
  }
}
```

### 配置项说明

- **validatorPath** (可选): glslangValidator 可执行文件的路径
  - 如果留空或未设置，会自动使用 `bin/glslangValidator`
  - 如果已添加到 PATH，可以直接使用 `"glslangValidator"`
  - 否则使用完整路径，例如：`"C:\\path\\to\\glslangValidator.exe"`（Windows）或 `"/usr/bin/glslangValidator"`（Linux/macOS）

- **validatorArgs** (可选): 传递给验证器的额外参数数组

- **fileExtensions** (可选): 文件扩展名到着色器阶段的映射
  - 如果留空或未设置，会自动使用 `{ ".comp.glsl": "comp" }`
  - 键：文件扩展名（如 `.comp`、`.frag`）
  - 值：着色器阶段类型（`vert`、`frag`、`comp`、`geom`、`tesc`、`tese`）

### 扩展打包结构

扩展会将 `bin` 目录打包到扩展中，安装后的结构如下：

```
~/.vscode/extensions/godot-compute-shader-linter-x.x.x/
├── bin/
│   ├── glslangValidator.exe      # Windows
│   └── glslangValidator          # Linux/macOS
├── extension.js
├── package.json
└── ...
```

扩展会自动根据操作系统选择正确的二进制文件，并使用扩展的安装路径来定位验证器。用户无需手动配置 `validatorPath`。

### 开发时的目录结构

开发时的项目结构：

```
godot-compute-shader-linter/
├── bin/
│   ├── glslangValidator.exe      # Windows
│   └── glslangValidator          # Linux/macOS
├── testshader/                    # 测试文件目录
│   ├── test01.comp.glsl
│   ├── test02.comp.glsl
│   └── test03.comp.glsl
├── .vscode/
│   ├── launch.json
│   ├── settings.json
│   └── tasks.json
├── extension.js
├── package.json
└── ...
```

**注意**: 调试时，扩展会使用当前工作目录下的 `bin` 目录，模拟安装后的行为。

## 开发和调试

### 环境准备

1. 克隆或下载此仓库
2. 在项目目录中运行：
   ```bash
   npm install
   ```

### 调试扩展

1. 在 VS Code 中打开此项目
2. 按 `F5` 或点击 "Run and Debug" 视图
3. 选择 "Run Extension" 配置
4. 这将打开一个新的 VS Code 窗口（扩展开发宿主），其中加载了您的扩展

### 测试扩展

1. 创建一个 GLSL 文件（例如 `test.comp.glsl`）
2. 确保文件扩展名在配置的 `fileExtensions` 中
3. 在文件中编写代码，例如：

```glsl
#[compute]

#version 450

layout(local_size_x = 8, local_size_y = 8, local_size_z = 1) in;

void main() {
    // 您的计算着色器代码
}
```

4. 如果代码有语法错误，扩展会在编辑器中显示错误标记
5. 查看 "Output" 面板中的 "Extension Host" 以查看调试日志

### 构建和运行

- **运行 lint 检查**: `npm run lint`
- **运行测试**: `npm test`

## 工作原理

1. 当打开或保存 GLSL 文件时，扩展会自动触发 lint 检查
2. 如果检测到 `#[compute]` 标记，会识别为 Godot Shader
3. 处理所有 `#include` 语句，递归读取被包含的文件
4. 如果文件没有 `#version` 指令，会自动添加 `#version 450`
5. 将处理后的代码传递给 glslangValidator 进行验证
6. 解析验证器的输出，并在编辑器中显示错误和警告
