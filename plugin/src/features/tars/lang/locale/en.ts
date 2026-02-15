// English

export default {
	// Common
	Error: 'Error',
	user: 'user',
	system: 'system',
	assistant: 'assistant',
	newChat: 'newChat',
	'Conversion failed. Selected sections is a': 'Conversion failed. Selected sections is a',
	message: 'message',
	'Check the developer console for error details. ': 'Check the developer console for error details. ',
	'Cancel generation': 'Cancel generation',

	// commands/asstTag.ts
	'Regenerate?': 'Regenerate?',
	'This will delete the current response content. You can configure this in settings to not require confirmation.':
		'This will delete the current response content. You can configure this in settings to not require confirmation.',
	Yes: 'Yes',

	// commands/export.ts
	'Export conversations to JSONL': 'Export conversations to JSONL',
	'No conversation found': 'No conversation found',
	'Exported to the same directory, Obsidian does not display the JSONL format. Please open with another software.':
		'Exported to the same directory, Obsidian does not display the JSONL format. Please open with another software.',

	// commands/replaceTag.ts
	'Replace speaker with tag': 'Replace speaker with tag',
	'No speaker found': 'No speaker found',
	'Replace the names of the two most frequently occurring speakers with tag format.':
		'Replace the names of the two most frequently occurring speakers with tag format.',
	Replace: 'Replace',

	// commands/select.ts
	'Select message at cursor': 'Select message at cursor',
	'No message found at cursor': 'No message found at cursor',

	// providers
	'API key is required': 'API key is required',
	'API secret is required': 'API secret is required',
	'Model is required': 'Model is required',
	'API URL is required': 'API URL is required',
	'API key may be incorrect. Please check your API key.': 'API key may be incorrect. Please check your API key.',
	'Access denied. Please check your API permissions.': 'Access denied. Please check your API permissions.',
	'Provider not configured': 'Provider not configured. Please add it in Formify settings first.',
	'Text Generation': 'Text Generation',
	'Image Vision': 'Image Vision',
	'PDF Vision': 'PDF Vision',
	'Image Generation': 'Image Generation',
	'Image Editing': 'Image Editing',
	'Web Search': 'Web Search',
	Reasoning: 'Reasoning',
	'Only PNG, JPEG, GIF, and WebP images are supported.': 'Only PNG, JPEG, GIF, and WebP images are supported.',
	'Only PNG, JPEG, GIF, WebP, and PDF files are supported.': 'Only PNG, JPEG, GIF, WebP, and PDF files are supported.',

	// providers/gptImage.ts
	'Only the last user message is used for image generation. Other messages are ignored.':
		'Only the last user message is used for image generation. Other messages are ignored.',
	'Multiple embeds found, only the first one will be used': 'Multiple embeds found, only the first one will be used',
	'Only PNG, JPEG, and WebP images are supported for editing.':
		'Only PNG, JPEG, and WebP images are supported for editing.',
	'Embed data is empty or invalid': 'Embed data is empty or invalid',
	'Failed to generate image. no data received from API': 'Failed to generate image. no data received from API',

	// editor.ts
	'Please add a user message first, or wait for the user message to be parsed.':
		'Please add a user message first, or wait for the user message to be parsed.',
	'Waiting for metadata to be ready. Please try again.': 'Waiting for metadata to be ready. Please try again.',
	'No text generated': 'No text generated',
	characters: 'characters',

	// main.ts
	'Removed commands': 'Removed commands',
	'Added commands': 'Added commands',
	'No active generation to cancel': 'No active generation to cancel',
	'Generation already cancelled': 'Generation already cancelled',
	'Generation cancelled': 'Generation cancelled',

	// settingTab.ts
	'Restore default': 'Restore default',
	'AI assistants': 'AI assistants',
	'New AI assistant': 'New AI assistant',
	'For those compatible with the OpenAI protocol, you can select OpenAI.':
		'For those compatible with the OpenAI protocol, you can select OpenAI.',
	'Add AI Provider': 'Add AI Provider',
	'Please add at least one AI assistant to start using the plugin.':
		'Please add at least one AI assistant to start using the plugin.',
	'Test model': 'Test model',
	'Test model description': 'Send a simple request to verify the current provider configuration.',
	'Test now': 'Test now',
	'Testing model...': 'Testing model...',
	'Model test succeeded': 'Model test passed',
	'Model test failed': 'Model test failed',
	'Vendor not found': 'Vendor not found',
	'Model test embed unsupported': 'Embeds are not supported during testing.',
	'Model test system prompt': 'You are verifying connectivity for the Obsidian Formify plugin.',
	'Model test user prompt': 'Please reply with a short confirmation message.',
	'Model test empty response': 'Model returned empty response during testing.',
	'Obtain key from ': 'Obtain key from ',
	'Web search': 'Web search',
	'Enable web search for AI': 'Enable web search for AI',
	'API key (required)': 'API key (required)',
	'API key (已设置)': 'API key (configured)',
	'API Secret (已设置)': 'API Secret (configured)',
	'Default:': 'Default:',
	'Refer to the technical documentation': 'Refer to the technical documentation',
	Model: 'Model',
	'Supported features': 'Supported features',
	'Select the model to use': 'Select the model to use',
	'Custom': 'Custom',
	'Custom model name': 'Custom model name',
	'Enter custom model name': 'Enter custom model name',
	'Back to preset models': 'Back to preset models',
	'Switch to custom input': 'Switch to custom input',
	'Switch to model selection': 'Switch to model selection',
	'Please input API key first': 'Please input API key first',
	'Please enter a number': 'Please enter a number',
	'Minimum value is 256': 'Minimum value is 256',
	'Invalid URL': 'Invalid URL',
	'Override input parameters': 'Override input parameters',
	'Developer feature, in JSON format. For example, if the model list doesn\'t have the model you want, enter {"model": "your desired model"}':
		'Developer feature, in JSON format. For example, if the model list doesn\'t have the model you want, enter {"model": "your desired model"}',
	'Advanced parameters in JSON format. For other parameters besides model (e.g., temperature, top_p, etc.). Model name should be set in the Model field above.':
		'Advanced parameters in JSON format. For other parameters besides model (e.g., temperature, top_p, etc.). Model name should be set in the Model field above.',
	'Additional parameters': 'Additional parameters',
	'Additional parameters description':
		'Set additional API parameters in JSON format (e.g., temperature, top_p, max_tokens). Note: Do not set the model parameter here.',
	'Please set model in the Model field above, not here': 'Please set model in the Model field above, not here',
	'Common parameters example': 'Common parameters example: {"temperature": 0.7, "top_p": 0.9, "max_tokens": 2000}',
	'Remove AI assistant': 'Remove AI assistant',
	Remove: 'Remove',
	Endpoint: 'Endpoint',
	'API version': 'API version',
	'Select assistant': 'Select assistant',
	'Provider tag': 'Provider tag',
	'A short identifier used to reference this provider': 'A short identifier used to reference this provider',
	'Provider tag must be unique': 'Provider tag must be unique',
	'Provider tag must not contain #': 'Provider tag must not contain #',
	'Provider tag must not contain space': 'Provider tag must not contain space',
	'Invalid provider tag': 'Invalid provider tag',

	'Internal links': 'Internal links',
	'Internal links in user and system messages will be replaced with their referenced content. When disabled, only the original text of the links will be used.':
		'Internal links in user and system messages will be replaced with their referenced content. When disabled, only the original text of the links will be used.',

	// Advanced settings
	'System message': 'System message',
	'Enable default system message': 'Enable default system message',
	'Automatically add a system message when none exists in the conversation':
		'Automatically add a system message when none exists in the conversation',
	'Default system message': 'Default system message',
	Advanced: 'Advanced',

	// gpt image settings
	'Image Display Width': 'Image Display Width',
	'Example: 400px width would output as ![[image.jpg|400]]': 'Example: 400px width would output as ![[image.jpg|400]]',
	'Number of images': 'Number of images',
	'Number of images to generate (1-5)': 'Number of images to generate (1-5)',
	'Image size': 'Image size',
	landscape: 'landscape',
	portrait: 'portrait',
	'Output format': 'Output format',
	Quality: 'Quality',
	'Quality level for generated images. default: Auto': 'Quality level for generated images. default: Auto',
	Auto: 'Auto',
	High: 'High',
	Medium: 'Medium',
	Low: 'Low',
	Background: 'Background',
	'Background of the generated image. default: Auto': 'Background of the generated image. default: Auto',
	Transparent: 'Transparent',
	Opaque: 'Opaque',
	'Output compression': 'Output compression',
	'Compression level of the output image, 10% - 100%. Only for webp or jpeg output format':
		'Compression level of the output image, 10% - 100%. Only for webp or jpeg output format',

	// suggest.ts
	'AI generate': 'AI generate',
	'Text generated successfully': 'Text generated successfully',
	'This is a non-streaming request, please wait...': 'This is a non-streaming request, please wait...',

	// Claude thinking settings
	Thinking: 'Thinking',
	'When enabled, Claude will show its reasoning process before giving the final answer.':
		'When enabled, Claude will show its reasoning process before giving the final answer.',
	'Budget tokens for thinking': 'Budget tokens for thinking',
	'Must be ≥1024 and less than max_tokens': 'Must be ≥1024 and less than max_tokens',
	'Minimum value is 1024': 'Minimum value is 1024',

	// Doubao thinking settings
	'Doubao thinking mode': 'Doubao thinking mode',
	'Select a model first to configure deep thinking.': 'Select a model first to configure deep thinking.',
	'Select a model first': 'Select a model first',
	'Current model does not support configuring deep thinking.':
		'Current model does not support configuring deep thinking.',
	'Not supported': 'Not supported',
	'Force enable deep thinking': 'Force enable deep thinking',
	'Force disable deep thinking': 'Force disable deep thinking',
	'Let the model decide deep thinking automatically': 'Let the model decide deep thinking automatically',
	'Control whether the Doubao model performs deep thinking before answering.':
		'Control whether the Doubao model performs deep thinking before answering.',
	'Reasoning effort': 'Reasoning effort',
	'Adjust how long the model thinks before answering. Only available when deep thinking is enabled.':
		'Adjust how long the model thinks before answering. Only available when deep thinking is enabled.',
	'Minimal reasoning (direct answer)': 'Minimal reasoning (direct answer)',
	'Low reasoning (quick response)': 'Low reasoning (quick response)',
	'Medium reasoning (balanced)': 'Medium reasoning (balanced)',
	'High reasoning (deep analysis)': 'High reasoning (deep analysis)',

	// statusBarManager.ts
	'AI Generation Details': 'AI Generation Details',
	Round: 'Round',
	Duration: 'Duration',
	'Start Time': 'Start Time',
	'End Time': 'End Time',
	'Error Details': 'Error Details',
	'Error Type': 'Error Type',
	'Error Message': 'Error Message',
	'Occurrence Time': 'Occurrence Time',
	'Stack Trace': 'Stack Trace',
	'Copy Error Info': 'Copy Error Info',
	'Error info copied to clipboard': 'Error info copied to clipboard',
	'Unknown Error': 'Unknown Error',
	'Tars AI assistant is ready': 'Formify AI assistant is ready',
	'Formify AI assistant is ready': 'Formify AI assistant is ready',
	'Generating round': 'Generating round',
	'answer...': 'answer...',
	'Generating...': 'Generating...',
	'Click status bar for error details. ': 'Click status bar for error details. ',
	Vendor: 'Vendor',
	Characters: 'Characters',

	'Enable Tars feature': 'Enable AI assistant feature',
	'Tars feature disabled description': 'Enable the feature above to configure AI assistants.',

	// MCP
	'MCP Servers': 'MCP Servers',
	'Enable MCP': 'Enable MCP',
	'Enable MCP description': 'When enabled, AI chat and form actions can use tools provided by MCP servers',
	'No MCP servers configured': 'No MCP servers configured. Click + to add or import mcp.json.',
	'Add MCP server': 'Add MCP Server',
	'Edit MCP server': 'Edit MCP Server',
	'Import MCP config': 'Import MCP Config',
	'Import mcp.json': 'Import mcp.json',
	'MCP server name': 'Name',
	'MCP server name desc': 'A name to identify this MCP server',
	'MCP transport type': 'Transport Type',
	'MCP command': 'Command',
	'MCP command desc': 'Command to start the MCP server',
	'MCP args': 'Arguments',
	'MCP args desc': 'Comma-separated command line arguments',
	'MCP env': 'Environment Variables',
	'MCP env desc': 'KEY=VALUE pairs, one per line',
	'MCP cwd': 'Working Directory',
	'MCP cwd desc': 'Optional process working directory',
	'MCP websocket url': 'WebSocket URL',
	'MCP timeout': 'Timeout (ms)',
	'MCP timeout desc': 'Maximum wait time for connection and requests',
	'MCP status idle': 'Idle',
	'MCP status connecting': 'Connecting...',
	'MCP status running': 'Running',
	'MCP status stopping': 'Stopping...',
	'MCP status stopped': 'Stopped',
	'MCP status error': 'Error',
	'MCP import success': 'Import successful',
	'MCP import failed': 'Import failed',
	'MCP server name required': 'Please enter server name',
	'MCP command required': 'Please enter command',
	'MCP url required': 'Please enter WebSocket URL',
}
