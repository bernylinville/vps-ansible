# Vibe Coding 指南

## 什么是 Vibe Coding？

Vibe Coding 是一种以 AI 协作为核心的开发方式。在这个项目中，我们拥抱 AI 辅助开发，同时保持工程纪律。

## 核心原则

### 1. AI 是副驾驶，不是替代

- AI 负责生成样板代码和重复性任务
- 人类负责架构决策、安全审查和最终验证
- 所有 AI 生成的代码必须经过审查和测试

### 2. 上下文即代码

- 项目文档 (AGENTS.md, CLAUDE.md) 是 AI 的"系统提示"
- 保持文档与代码同步更新
- 使用明确的文件结构和命名约定

### 3. 安全不可妥协

- AI 可能生成不安全的代码模式
- 必须人工审查所有安全相关变更
- 使用自动化工具 (ansible-lint, yamllint) 作为安全网

## 与 AI 协作的最佳实践

### 开始新任务

1. **阅读上下文**：先阅读 AGENTS.md 和相关文档
2. **明确需求**：提供具体、可验证的需求描述
3. **迭代开发**：小步快跑，频繁验证

### 代码审查清单

- [ ] 是否遵循项目结构约定？
- [ ] 是否有硬编码的敏感数据？
- [ ] 是否处理了错误情况？
- [ ] 是否幂等（可重复执行）？
- [ ] 是否有适当的注释和文档？

### 提示工程技巧

```
好的提示：
"在 roles/traefik/defaults/main.yml 中添加 
metrics_enabled 变量，默认值为 true，
并在 compose.yml.j2 模板中使用它控制 
--metrics.prometheus 标志"

差的提示：
"添加监控"
```

## 项目特定的 Vibe

### 命名风格

- 变量：`snake_case`
- 文件：`kebab-case.yml`
- 角色：`lowercase`
- 容器名：`service-name`

### 代码风格

- YAML：2 空格缩进，无 Tab
- 行宽：约 120 字符
- 任务必须有 `name`
- 优先使用模块而非 `command/shell`

### 文档风格

- 中英双语（关键文档）
- 表格用于对比和清单
- 代码块用于示例
- 链接引用外部资源

## 工具链

### AI 助手

- **Claude Code**：主要开发助手
- **GitHub Copilot**：代码补全
- **Ansible Lint**：静态检查

### 开发环境

```bash
# 推荐的开发流程
1. 激活虚拟环境
   source .venv/bin/activate

2. 进行修改

3. 本地验证
   yamllint .
   ansible-lint
   ansible-playbook --check --diff

4. 提交变更
   git add .
   git commit -m "feat: description"

5. 推送到 PR
   git push origin feature/xxx
```

## 常见模式

### 添加新服务

```
1. 创建角色目录
   mkdir -p roles/new-service/{defaults,tasks,templates}

2. 定义默认变量
   roles/new-service/defaults/main.yml

3. 实现部署任务
   roles/new-service/tasks/main.yml

4. 创建模板文件
   roles/new-service/templates/compose.yml.j2

5. 注册到 Playbook
   playbooks/site.yml

6. 添加组变量
   inventory/prod/group_vars/vps/main.yml

7. 更新文档
   docs/architecture.md
   README.md
```

### 调试技巧

```bash
# 查看变量值
ansible-playbook ... -vvv

# 仅运行特定任务
ansible-playbook ... --start-at-task "Task Name"

# 检查模板渲染
ansible-playbook ... --check --diff

# 临时变量覆盖
ansible-playbook ... -e "variable=value"
```

## 持续改进

- 定期回顾和更新 AGENTS.md
- 记录常见问题和解决方案
- 分享有效的 AI 提示模式
- 优化自动化检查规则

## 参考

- [Ansible Best Practices](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_best_practices.html)
- [YAML Style Guide](https://yaml.org/spec/)
- [Conventional Commits](https://www.conventionalcommits.org/)
