<script lang="ts">
	import '../app.css';
	import Notices from '$components/Notices.svelte';
	let { children } = $props();
</script>

<div class="app">
	{@render children()}
</div>
<Notices />

<style>
	.app {
		display: flex;
		flex-direction: column;
		height: 100vh;
		overflow: hidden;
	}
</style>
