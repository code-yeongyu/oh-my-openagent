{
  description = "nous-omc — context-gc PR dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      devShells.${system}.default = pkgs.mkShell {
        packages = [ pkgs.bun pkgs.nodejs pkgs.git ];
        shellHook = ''
          echo "nous-omc devshell — bun $(bun --version)"
        '';
      };
    };
}
