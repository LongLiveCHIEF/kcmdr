# Contributing and Developer Docs

- [Local Dev Setup](#local-dev-setup)
  - [Pre-requisites](#pre-requisites)
  - [Development Setup](#development-setup)
  - [Overview](#overview)
    - [Mise](#mise)
    - [Nx](#nx)


## Local Dev Setup

### Pre-requisites

1. Docker for executing e2e tests and running the virtual klipper printer (optionally you can just use a real klipper host/printer)
2. Git
3. [Install mise](https://mise.jdx.dev/getting-started.html#installing-mise-cli)(see [Overview](#overview))
4. (optional) [Activate mise][mise-activate] for autoloading of tools and environment vars

### Development Setup

1. Fork/clone this repo onto your development machine
1. Run `mise install` (if you don't have mise activated)

### Overview

#### Mise
We use [mise](https://mise.jdx.com) to help you configure your local tools and environment regardless
of the OS you choose to develop with.

Mise will help you setup the right version of python, node, pnpm, and it will automatically update the
virtual test infrastructure using git submodules.

We have several mise tasks, although you can do just about everything you need using the `nx` tasks once
you've installed node packages the project depends on.

#### Nx

We use [Nx][] as the primary dependency and build/dev task orchestration tool.

[mise-activate]: https://mise.jdx.dev/getting-started.html#activate-mise
[Nx]: https://nx.dev
