{
  description = "The Best AI Agent Harness - Batteries-Included OpenCode Plugin";

  inputs = {
    nixpkgs.url = "nixpkgs";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
        };
        packageJson = builtins.fromJSON (builtins.readFile ./package.json);
        version = packageJson.version;

        node_modules = pkgs.stdenvNoCC.mkDerivation {
          name = "oh-my-opencode-node_modules-${version}";
          src = pkgs.lib.fileset.toSource {
            root = ./.;
            fileset = pkgs.lib.fileset.unions [
              ./package.json
              ./bun.lock
            ];
          };

          nativeBuildInputs = with pkgs; [
            bun
            cacert
          ];

          buildPhase = ''
            export HOME=$(mktemp -d)
            export BUN_INSTALL_CACHE_DIR=$(mktemp -d)
            bun install --no-progress --ignore-scripts
          '';

          installPhase = ''
            mkdir -p $out
            cp -r node_modules $out/
          '';

          outputHashMode = "recursive";
          outputHashAlgo = "sha256";
          outputHash = "sha256-KcJmtWLVcJvazLs+Ffb8HWju0pwVlLZHCWQIuzaIeXQ=";
        };
      in
      {
        packages.node_modules = node_modules;

        packages.oh-my-opencode = pkgs.stdenvNoCC.mkDerivation {
          pname = "oh-my-opencode";
          inherit version;
          src = self;

          nativeBuildInputs =
            with pkgs;
            [
              bun
              nodejs_24
              makeWrapper
              autoPatchelfHook
            ]
            ++ (with pkgs.nodePackages; [ typescript ]);

          buildInputs = with pkgs; [
            pkgs.stdenv.cc.cc.lib
          ];

          autoPatchelfIgnoreMissingDeps = [
            "libc.musl-x86_64.so.1"
            "libc.musl-aarch64.so.1"
          ];

          buildPhase = ''
            cp -r ${node_modules}/node_modules .
            chmod -R u+w node_modules
            patchShebangs node_modules/
            export HOME=$(mktemp -d)
            bun run build
          '';

          installPhase = ''
            mkdir -p $out/lib/oh-my-opencode
            mkdir -p $out/bin

            cp -r dist $out/lib/oh-my-opencode/
            cp -r node_modules $out/lib/oh-my-opencode/
            cp package.json $out/lib/oh-my-opencode/

            makeWrapper ${pkgs.bun}/bin/bun $out/bin/oh-my-opencode \
              --add-flags "$out/lib/oh-my-opencode/dist/cli/index.js" \
              --prefix PATH : ${
                pkgs.lib.makeBinPath [
                  pkgs.bun
                  pkgs.nodejs_24
                ]
              }
          '';

          meta = with pkgs.lib; {
            description = "The Best AI Agent Harness - Batteries-Included OpenCode Plugin";
            homepage = "https://github.com/code-yeongyu/oh-my-opencode";
            license = licenses.unfree; # SUL-1.0
            platforms = platforms.linux ++ platforms.darwin;
          };
        };

        packages.default = self.packages.${pkgs.stdenv.hostPlatform.system}.oh-my-opencode;

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            bun
            nodejs_24
          ];
        };
      }
    );
}
