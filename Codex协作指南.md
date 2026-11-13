# 《校门口小卖部》Codex 协作指南

项目仓库：[lml23332/-](https://github.com/lml23332/-)。负责人会邀请你的 GitHub 账号。接受邀请后，你就可以克隆项目、在自己的 Codex 里改代码，并把改动作为 Pull Request（PR，合并请求）提交给负责人。

## 第一次：把项目下载到自己的电脑

1. 用受邀的 GitHub 账号登录，打开邀请链接，点击 **Accept invitation**。
2. 在电脑上打开终端，进入想放项目的目录，运行以下命令。如果终端找不到 `git`，也可以在仓库页面点 **Code → Open with GitHub Desktop**，选择保存位置并点 **Clone**。

   ```bash
   git clone https://github.com/lml23332/-.git xiaomaibu
   cd xiaomaibu
   ```

3. 用 Codex 打开克隆下来的整个项目文件夹。双击文件夹中的 `index.html` 可以试玩。

如果你之前在 ZIP 解压目录里已经改了代码，先按下面的步骤在克隆仓库里开分支，再复制你改过的文件，核对差异后提交。

## 每次开工：从最新的 main 开分支

在项目目录运行 `git status --short`。有输出时，先确认并保留已有改动；工作区干净后再运行下面三行。每个新任务换一个分支名，下面以手机货架为例。

```bash
git switch main
git pull --ff-only origin main
git switch -c codex/mobile-shelf
```

然后让 Codex 修改你负责的功能。开工前读一下仓库的 `AGENTS.md` 和 `DESIGN.md`。涉及游戏规则时，同步更新 `GAME-PROMPT.md` 中受影响的内容。

## 改完：提交、推送、开 PR

1. 先试玩受影响的流程。改界面就试一下手机窄屏，改存档就用旧存档续玩。用下面的命令看文件状态和改动。

   ```bash
   git status --short
   git diff
   ```

2. 如果列出的变更都属于这次任务，运行下面的命令。提交说明换成这次实际改动；暂存后可以用 `git diff --cached` 再核对一遍。若工作区混有其他任务的改动，用 `git add -- 文件路径` 逐个暂存。

   ```bash
   git add -A
   git diff --cached --stat
   git commit -m "优化手机端货架布局"
   git push -u origin HEAD
   ```

3. 回到 GitHub 仓库，点击 **Compare & pull request**。如果页面没有出现这个按钮，可以从 **Pull requests → New pull request** 进入。确认 **base** 是 `main`，**compare** 是你刚推送的功能分支，然后点击 **Create pull request**。
4. 在 PR 写清楚改了什么、怎么试玩、已经验证了什么，把 PR 链接发给负责人。负责人试玩确认后合并。

## PR 提示有冲突时

回到你自己的功能分支，合入最新的 `main`。把示例分支名换成你的实际分支名。

```bash
git switch codex/mobile-shelf
git fetch origin
git merge origin/main
```

如果出现冲突，请 Codex 对照两边的改动解决，然后重新试玩。解决后暂存冲突文件并运行 `git commit`。最后运行 `git push`，原来的 PR 会自动更新。合并完成后，下次开工再从最新的 `main` 开分支。

## 可以直接复制给 Codex

**开工时**

> 这是《校门口小卖部》的克隆仓库。先读 AGENTS.md 和 DESIGN.md，检查当前分支和工作区，保留已有改动。在工作区干净的情况下，从最新的 origin/main 开一个 codex/ 前缀的功能分支。我的任务是：【在这里填写要改的功能】。完成后验证受影响的流程，告诉我怎么试玩。

**改完准备提交时**

> 检查当前功能分支和差异，只提交这次任务相关的文件。验证后提交并推送当前分支，创建一个目标为 main 的 PR，写清改动和验证结果，把 PR 链接给我，留给项目负责人合并。如果 GitHub 提示有冲突，在当前功能分支合入最新的 origin/main，解决冲突并重新验证。如果当前环境无法创建 PR，给我 GitHub 上的手动创建步骤。
