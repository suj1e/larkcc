# Contributing to larkcc

Thanks for your interest in contributing to larkcc!

## Development Setup

### Prerequisites

- Node.js >= 18
- pnpm >= 9

### Setup

```bash
git clone https://github.com/suj1e/larkcc.git
cd larkcc
pnpm install
```

### Development

```bash
pnpm dev        # Development mode with hot reload
pnpm build      # Build to dist/
pnpm start      # Run built version
```

## How to Contribute

### Reporting Bugs

- Use the [Bug Report template](https://github.com/suj1e/larkcc/issues/new?template=bug_report.yml)
- Provide clear reproduction steps
- Include your Node.js version and larkcc version

### Suggesting Features

- Use the [Feature Request template](https://github.com/suj1e/larkcc/issues/new?template=feature_request.yml)
- Describe the problem you're trying to solve
- Explain your proposed solution

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Commit with a clear message
5. Push to your fork: `git push origin feature/your-feature`
6. Open a Pull Request

## Code Style

- TypeScript strict mode is enabled
- Keep the code clean and readable
- Add comments where necessary

## Commit Message Convention

We recommend using [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation update
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Build process or tooling changes

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
