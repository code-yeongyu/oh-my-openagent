// `prompts-core` ships markdown prompt bodies that are imported as text. This
// adapter consumes those modules (the ultrawork directive), so the ambient
// declaration has to exist inside this package's program too.
declare module "*.md" {
	const content: string;
	export default content;
}
