<script lang="ts">
	// The backdrop behind a modal. The one piece of markup all four dialogs
	// genuinely had in common -- four byte-identical copies of the same rule.
	//
	// Each dialog still owns its own box: its width, its top, its padding. Only
	// the sheet of dark behind it is shared, and only because there is nothing
	// about it that could differ.
	let { onclose, enabled = true }: { onclose: () => void; enabled?: boolean } = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="scrim"
	onclick={() => {
		if (enabled) onclose();
	}}
></div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 90;
		background: rgb(0 0 0 / 35%);
	}
</style>
