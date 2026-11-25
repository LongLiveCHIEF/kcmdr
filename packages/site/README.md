# Website

This website is built using [Docusaurus 3](https://docusaurus.io/), a modern static website generator.

### Installation

From the workspace root:

```
$ pnpm install
```

### Local Development

```
$ pnpm nx run site:start
```

This command starts a local development server and opens up a browser window. Most changes are reflected live without having to restart the server.

### Build

```
$ pnpm nx run site:build
```

This command generates static content into the `dist` directory and can be served using any static contents hosting service.
