> [!NOTE]
> **OmO ベータ: OmO ❤️ Pi**
> `bun add -g omo-ai` でインストールしてください。メモリシステム、CodeMode、Anthropic サブスクリプションにすべて対応しています。
> [![OmO Herdr DAG - live OmO workflow DAGs in a Herdr side pane](./.github/assets/omo-herdr-dag.png)](https://github.com/jc01rho/omo-herdr-dag)
> *プロンプトに "mass ulw" と入れるだけ。あなたはもうグラフエンジニアリングのマスター。マルチモデルの ultracode を、より良いメモリシステムとともに。(右側のパネルは [omo-herdr-dag](https://github.com/jc01rho/omo-herdr-dag) です)*


> **Sponsors**
> 以下は私たちのスポンサーです。個人のサイドプロジェクトとして継続するための支援をいただいています。
> | [<img alt="OpenGateway" src="./.github/assets/opengateway-logo.svg" width="156px" />](https://opengateway.ai/) | **[OpenGateway](https://opengateway.ai/)** は OmO のスポンサーです。複数のモデルプロバイダーをひとつの API で使える OpenAI 互換ゲートウェイです。オープンソースへのご支援に感謝します。 |
> | :-----| :----- |


> [!NOTE]
>
> [![Sisyphus Labs - Meet Dori. Not a demo. Subscribes to everything.](./.github/assets/sisyphuslabs.png?v=4)](https://sisyphuslabs.ai)
> > **OmO は上記の Jobdori によってメンテナンスされています。あなた専用の Jobdori、Dori に会いましょう。 <br />[こちら](https://sisyphuslabs.ai) からウェイトリストにご登録ください。**

> [!TIP]
> 私たちと一緒に！
>
> | [<img alt="Discord link" src="https://img.shields.io/discord/1452487457085063218?color=5865F2&label=discord&labelColor=black&logo=discord&logoColor=white&style=flat-square" width="156px" />](https://discord.gg/PUwSMR9XNk) | [Discord コミュニティ](https://discord.gg/PUwSMR9XNk) に参加して、コントリビューターや他の OmO ユーザーと交流しましょう。 |
> | :-----| :----- |
> | [<img alt="X link" src="https://img.shields.io/badge/Follow-%40justsisyphus-00CED1?style=flat-square&logo=x&labelColor=black" width="156px" />](https://x.com/justsisyphus) | OmO のアップデートは以前、私の X アカウントで投稿されていましたが、 <br /> 誤って凍結されてしまったため、現在は [@justsisyphus](https://x.com/justsisyphus) が代わりにアップデートを投稿しています。 |
> | [<img alt="GitHub Follow" src="https://img.shields.io/github/followers/code-yeongyu?style=flat-square&logo=github&labelColor=black&color=24292f" width="156px" />](https://github.com/code-yeongyu) | さらに多くのプロジェクトを見たい場合は、GitHub で [@code-yeongyu](https://github.com/code-yeongyu) をフォローしてください。 |

<!-- <CENTERED SECTION FOR GITHUB DISPLAY> -->

<div align="center">

<a href="https://omo.dev"><img src="./.github/assets/omo-icon-light.svg" alt="OmO" width="200" /></a>

# OmO

**Your tool for real work. But it's an agent.**

[![GitHub Release](https://img.shields.io/github/v/release/code-yeongyu/oh-my-openagent?color=369eff&labelColor=black&logo=github&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/releases)
[![npm downloads](https://img.shields.io/endpoint?url=https%3A%2F%2Fomo.dev%2Fapi%2Fnpm-downloads&style=flat-square)](https://www.npmjs.com/package/omo-ai)
[![GitHub Contributors](https://img.shields.io/github/contributors/code-yeongyu/oh-my-openagent?color=c4f042&labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/graphs/contributors)
[![GitHub Stars](https://img.shields.io/github/stars/code-yeongyu/oh-my-openagent?color=ffcb47&labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/stargazers)
[![License](https://img.shields.io/badge/license-SUL--1.0-white?labelColor=black&style=flat-square)](https://github.com/code-yeongyu/oh-my-openagent/blob/dev/LICENSE.md)
[![Docs](https://img.shields.io/badge/docs-omo.dev-369eff?labelColor=black&logo=readthedocs&logoColor=white&style=flat-square)](https://omo.dev/docs)

[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-cn.md) | [Русский](README.ru.md)

</div>

<!-- </CENTERED SECTION FOR GITHUB DISPLAY> -->

OmO は、あなたのトークンを完成した成果に変える `omo` コマンドひとつです。1万を超えるソースのリサーチ、すっと理解できる資料、バックエンド、フロントエンド、コーディングまで対応します。[pi](https://github.com/badlogic/pi-mono) のフォークである senpi 上で動作し、以下の機能をすべて標準で備えています。

## インストール

```bash
bun add -g omo-ai
omo
```

bun がない場合は `npm i -g omo-ai` でも動きます。パッケージ名は `omo-ai` です。npm にある `omo` パッケージは無関係の別物です。

プロジェクトを開いて `omo` を実行し、やることを伝えてください。セットアップはそれだけです。

OpenCode 版や LazyCodex から移行する場合は、`omo setup` を一度実行してください。プロバイダーキー、カスタムプロバイダー、MCP サーバー、スキル、モデルの選択を引き継ぎます。続けて `omo doctor` を実行すると、お使いのプロバイダーでどのタスクカテゴリを実行できるか、旧インストールに何が残っているかを確認できます。詳しい手順は [OpenCode からの移行](docs/guide/migrating-from-opencode.md) をご覧ください。

`omo update` でその場で更新できます。削除するには `bun remove -g omo-ai`(または `npm uninstall -g omo-ai`)を実行します。

## なぜ OmO か

**ultrawork。** この先を学ばなくても大丈夫です。難しそうな仕事なら、プロンプトに `ultrawork`(または `ulw`)と添えてください。エージェントは1行でも触れる前にコードベースを読み、計画を立て、各ステップを証明してから次へ進みます。実際の画面や環境で結果を確かめ、完了したら止まります。

**何百ものエージェントを、キーワードひとつで。** `mass ulw` と入力すると、仕事全体がエージェントのグラフになります。数千のソースを読むディープリサーチ、機械学習パイプライン全体の構築、誰もやりたくないマイグレーションまで。部分ごとに合うモデルが並列で動き、完了と言う前に検証します。

**Kibitzer。あなたのエージェントは、あなたと仕事を忘れません。** 記憶は markdown ファイルからなる git リポジトリに保存されます。小さく安価なモデルが高価なメインエージェントの隣に座り、あなたがしてきたことを読み取り、メインが同じ失敗を繰り返す前にそっと促します。あなたは同じ説明を繰り返さなくなります。

**迷わないマルチモデル。** お気に入りのフロンティアモデルと、安価なモデルを混ぜて使えます。ログインするだけです。`/login` で Claude、ChatGPT、Kimi、GLM のサブスクリプションに対応しています。モデルごとに調整されたシステムプロンプトが付いてくるので、選び間違えることがありません。

**高品質なスキルを、必要なものだけ。** あなたのモデルは賢いけれど、現実の問題を解くには知らないことがまだ多くあります。OmO はその欠けた知識をブラウザ操作も含めてスキルとして届け、いまの仕事に必要なものだけを読み込みます。

**それ以外も、すべてが crafted されています。** 独立したツール呼び出しは小さなプログラムひとつでまとめて実行されるので、20回の読み込みも1回の往復で済みます。壊れたツール引数は実行前に修復されます。ビルドやデプロイを待つことはポーリングではなく購読です。長い作業は何を確認したかを記録するので、セッションが再開しても止まった場所から続きます。設定、スキル、プロンプトはライブで再読み込みされます。

## 設定

こだわりのあるデフォルトを用意していますが、望めば調整できます。設定は `~/.omo/omo.jsonc` に保存され、プロジェクトごとに `.omo/omo.jsonc` を追加することもできます。最も近いファイルが優先されます。すべてのキーは [設定リファレンス](docs/reference/configuration.md) に載っています。

## ドキュメント

- [omo.dev/docs](https://omo.dev/docs)
- [OpenCode からの移行](docs/guide/migrating-from-opencode.md)
- [設定リファレンス](docs/reference/configuration.md)
- [機能一覧](docs/reference/features.md)
- [Ultrawork マニフェスト](docs/manifesto.md)

## レビュー

> "It made me cancel my Cursor subscription. Unbelievable things are happening in the open source community." - [Arthur Guiot](https://x.com/arthur_guiot/status/2008736347092382053?s=20)

> "If Claude Code does in 7 days what a human does in 3 months, OmO does it in 1 hour." <br/>- B, Quant Researcher

> "You guys should pull this into core and recruit him. Seriously. It's really, really, really good." <br/>- Henning Kilset

## 作者より

エージェントからハンドルを取り戻さなければならないとき、それはチームワークではありません。システムの失敗です。OmO はこの考えの上に作られています。

あなたは望むことを伝えるだけです。エージェントがリサーチし、計画し、シニアエンジニアと見分けがつかないコードを書き、検証し、終わるまで進み続けます。本当に速さにつながるときはトークンを使い、簡単な部分は安価なモデルに回します。

私はこのプロジェクトの最も熱心なユーザーです。どのモデルのロジックが最も鋭いか。誰が最も良い文章を書くか。今週ほかの人たちは何をリリースしたか。その答えが集まる場所が OmO です。もっと良い方法があれば、PR を歓迎します。

目指すのは、存在を意識しなくなるエージェントです。スイッチを入れれば、明かりがつく。詳しくは [Ultrawork マニフェスト](docs/manifesto.md) をご覧ください。

ここで言及しているプロジェクトやモデルとは一切提携していません。Ultragoal と UltraQA のアイデアは [oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex) に由来し、OmO 向けにコンセプトから再実装したものです。

## 利用している企業

[Indent](https://indentcorp.com), makers of Spray (influencer marketing solution), vovushop (cross-border commerce platform) and vreview (AI commerce review marketing solution). [Google](https://google.com). [Microsoft](https://microsoft.com). [Vercel](https://vercel.com). [ELESTYLE](https://elestyle.jp), makers of elepay (multi-mobile payment gateway) and OneQR (mobile application SaaS for cashless solutions). [Deepgram](https://deepgram.com).
