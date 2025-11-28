---
trigger: glob
glob: .js,.ts,tsx,
---
# JavaScript/TypeScript 编码规范

## 1. 版本规范
### JavaScript
- 支持 ES6+ (ECMAScript 2015+)
- 使用 Babel 进行代码转译
- 明确指定 Node.js 版本要求（建议 14.x+）

### TypeScript
- 使用 TypeScript 4.x+ 版本
- 启用严格模式 (`strict: true`)
- 配置 `tsconfig.json` 明确编译选项

## 2. 代码风格规范
### 命名规范
```typescript
// 类名：使用大驼峰命名法
class UserService {
  // ...
}

// 接口名：使用大驼峰命名法，可以加 I 前缀
interface IUserData {
  // ...
}

// 函数名：使用小驼峰命名法
function calculateTotalPrice() {
  // ...
}

// 变量名：使用小驼峰命名法
const userData = { ... };

// 常量：使用大写字母和下划线
const MAX_RETRY_COUNT = 3;

// 组件名：使用大驼峰命名法
const UserProfile = () => {
  // ...
};
```

### 注释规范
```typescript
/**
 * 处理用户数据并返回处理后的结果
 * 
 * @param {number} userId - 用户ID
 * @param {Object} data - 原始用户数据
 * @returns {Promise<Object>} 处理后的用户数据
 * @throws {Error} 当用户ID不存在时抛出
 */
async function processUserData(userId: number, data: object): Promise<object> {
  // ...
}
```

## 3. 项目结构规范
推荐的项目结构：
```
project_name/
├── src/
│   ├── components/      # React/Vue组件
│   ├── services/       # 业务服务
│   ├── utils/         # 工具函数
│   ├── types/         # TypeScript类型定义
│   └── constants/     # 常量定义
├── tests/
│   ├── unit/
│   └── integration/
├── public/
├── dist/              # 构建输出
├── node_modules/
├── package.json
├── tsconfig.json     # TypeScript配置
├── .eslintrc.js     # ESLint配置
├── .prettierrc      # Prettier配置
└── README.md
```

## 4. 依赖管理
- 使用 `npm` 或 `yarn` 管理依赖
- 锁定依赖版本（package-lock.json/yarn.lock）
- 区分 dependencies 和 devDependencies
- 定期更新依赖版本，处理安全隐患

## 5. TypeScript 特性使用
### 类型定义
```typescript
// 使用接口定义对象类型
interface User {
  id: number;
  name: string;
  age?: number;
}

// 使用类型别名定义联合类型
type Status = 'active' | 'inactive' | 'pending';

// 泛型使用
function getList<T>(items: T[]): T[] {
  return items;
}
```

### 类型断言
```typescript
// 使用 as 语法而不是尖括号
const value = someValue as string;
```

## 5. 异步编程规范
- 优先使用 async/await
- 正确处理异步错误
- 避免回调地狱

## 6. 前端框架特定规范
### React
- 使用函数组件和 Hooks
- 合理划分组件职责
- 使用 PropTypes 或 TypeScript 类型检查

### Vue
- 遵循 Vue 3 组合式 API 规范
- 使用 `<script setup>` 语法
- 使用 TypeScript 装饰器

## 性能优化
- 代码分割和懒加载
- 合理使用缓存
- 优化打包体积
- 使用性能分析工具

## 安全规范
- 防止 XSS 攻击
- 避免 SQL 注入
- 使用 HTTPS
- 保护敏感信息

## 文档规范
- 使用 JSDoc 或 TypeDoc 生成文档
- 编写详细的 README.md
- 组件文档使用 Storybook
- API 文档使用 Swagger/OpenAPI 