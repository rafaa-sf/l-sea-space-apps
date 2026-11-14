/**
 * Miro MCP tool definitions.
 *
 * Each tool maps to a Miro REST API v2 operation. Tool handlers receive the
 * parsed arguments and a Miro client instance, and return a plain JSON value
 * that the server serialises as MCP text content.
 */
import { z } from 'zod'

const ITEM_TYPES = [
  'sticky_note',
  'text',
  'shape',
  'frame',
  'card',
  'app_card',
  'image',
  'document',
  'embed',
  'connector',
]

/** @param {{ x?: number, y?: number, width?: number, height?: number, parentFrameId?: string }} args */
function buildPosition({ x, y, width, height, parentFrameId }) {
  const position = {}
  if (x !== undefined || y !== undefined) {
    position.x = x ?? 0
    position.y = y ?? 0
    position.origin = 'center'
  }
  if (width !== undefined) position.width = width
  if (height !== undefined) position.height = height
  /** @type {{ data?: object, style?: object, position?: object, parent?: object }} */
  const body = {}
  if (Object.keys(position).length > 0) body.position = position
  if (parentFrameId) body.parent = { id: parentFrameId }
  return body
}

/**
 * @param {Record<string, unknown>} data
 * @param {Record<string, unknown>} [style]
 */
function withDataAndStyle(data, style) {
  /** @type {Record<string, unknown>} */
  const body = { data }
  if (style && Object.keys(style).length > 0) body.style = style
  return body
}

export const tools = [
  {
    name: 'miro_list_boards',
    title: 'List Miro boards',
    description:
      'List the Miro boards the current user has access to. Supports pagination with cursor.',
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional().describe('Page size (1-50, default 50)'),
      cursor: z.string().optional().describe('Pagination cursor from a previous call'),
      query: z.string().optional().describe('Optional text filter for board names'),
    },
    /**
     * @param {import('./miro-client.js').MiroApiClient} client
     * @param {{ limit?: number, cursor?: string, query?: string }} args
     */
    handler: (client, args) => client.listBoards(args),
  },
  {
    name: 'miro_get_board',
    title: 'Get Miro board',
    description: 'Get the metadata of a single Miro board by board id.',
    inputSchema: {
      boardId: z.string().min(1).describe('Miro board id'),
    },
    handler: (client, { boardId }) => client.getBoard(boardId),
  },
  {
    name: 'miro_create_board',
    title: 'Create Miro board',
    description: 'Create a new Miro board with a name and optional description.',
    inputSchema: {
      name: z.string().min(1).describe('Board name'),
      description: z.string().optional().describe('Board description'),
    },
    handler: (client, { name, description }) =>
      client.createBoard({ name, description }),
  },
  {
    name: 'miro_list_items',
    title: 'List board items',
    description:
      'List items on a board (sticky notes, shapes, texts, frames, cards, connectors...). Use type to filter.',
    inputSchema: {
      boardId: z.string().min(1),
      limit: z.number().int().min(1).max(50).optional(),
      cursor: z.string().optional(),
      type: z.enum(ITEM_TYPES).optional().describe('Filter by item type'),
    },
    handler: (client, { boardId, ...opts }) => client.listItems(boardId, opts),
  },
  {
    name: 'miro_get_item',
    title: 'Get board item',
    description: 'Get a single item from a board by item id.',
    inputSchema: {
      boardId: z.string().min(1),
      itemId: z.string().min(1),
    },
    handler: (client, { boardId, itemId }) => client.getItem(boardId, itemId),
  },
  {
    name: 'miro_create_sticky_note',
    title: 'Create sticky note',
    description:
      'Create a sticky note on a board at a board coordinate (x, y in board units).',
    inputSchema: {
      boardId: z.string().min(1),
      content: z.string().describe('Sticky note text (supports basic HTML)'),
      x: z.number().optional(),
      y: z.number().optional(),
      color: z
        .string()
        .optional()
        .describe('Fill color, e.g. light_yellow, light_blue, red, green'),
      shape: z
        .enum(['square', 'rectangle', 'circle', 'triangle', 'rhombus'])
        .optional(),
      textAlign: z.enum(['left', 'center', 'right']).optional(),
      parentFrameId: z
        .string()
        .optional()
        .describe('Id of the frame that should contain the sticky note'),
    },
    handler: (client, args) => {
      const { boardId, content, color, shape, textAlign, parentFrameId } = args
      const style = {}
      if (color) style.fillColor = color
      if (textAlign) style.textAlign = textAlign
      const body = withDataAndStyle({ content, shape: shape ?? 'square' }, style)
      Object.assign(body, buildPosition({ x: args.x, y: args.y, parentFrameId }))
      return client.createStickyNote(boardId, body)
    },
  },
  {
    name: 'miro_create_text',
    title: 'Create text',
    description: 'Create a text item on a board.',
    inputSchema: {
      boardId: z.string().min(1),
      content: z.string().describe('Text content (supports basic HTML)'),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      fontSize: z.number().optional().describe('Font size in board units'),
      color: z.string().optional().describe('Text color, e.g. #1a1a1a'),
      textAlign: z.enum(['left', 'center', 'right']).optional(),
      parentFrameId: z.string().optional(),
    },
    handler: (client, args) => {
      const { boardId, content, fontSize, color, textAlign, parentFrameId } = args
      const style = {}
      if (fontSize) style.fontSize = fontSize
      if (color) style.color = color
      if (textAlign) style.textAlign = textAlign
      const body = withDataAndStyle({ content }, style)
      Object.assign(body, buildPosition({ x: args.x, y: args.y, width: args.width, parentFrameId }))
      return client.createText(boardId, body)
    },
  },
  {
    name: 'miro_create_shape',
    title: 'Create shape',
    description:
      'Create a shape (rectangle, circle, triangle...) with optional text content on a board.',
    inputSchema: {
      boardId: z.string().min(1),
      shape: z.enum([
        'rectangle',
        'round_rectangle',
        'circle',
        'triangle',
        'rhombus',
        'parallelogram',
        'trapezoid',
        'pentagon',
        'hexagon',
        'octagon',
        'wedge_round_rectangle_callout',
        'star',
        'flow_chart_predefined_process',
        'cloud',
        'cross',
        'can',
        'right_arrow',
        'left_arrow',
        'left_right_arrow',
        'left_brace',
        'right_brace',
      ]),
      content: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      fillColor: z.string().optional(),
      borderColor: z.string().optional(),
      textAlign: z.enum(['left', 'center', 'right']).optional(),
      parentFrameId: z.string().optional(),
    },
    handler: (client, args) => {
      const { boardId, shape, content, fillColor, borderColor, textAlign, parentFrameId } = args
      const data = { shape }
      if (content !== undefined) data.content = content
      const style = {}
      if (fillColor) style.fillColor = fillColor
      if (borderColor) style.borderColor = borderColor
      if (textAlign) style.textAlign = textAlign
      const body = withDataAndStyle(data, style)
      Object.assign(
        body,
        buildPosition({
          x: args.x,
          y: args.y,
          width: args.width,
          height: args.height,
          parentFrameId,
        }),
      )
      return client.createShape(boardId, body)
    },
  },
  {
    name: 'miro_create_frame',
    title: 'Create frame',
    description: 'Create a frame (a container area) on a board.',
    inputSchema: {
      boardId: z.string().min(1),
      title: z.string().describe('Frame title'),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      fillColor: z.string().optional(),
    },
    handler: (client, args) => {
      const { boardId, title, fillColor } = args
      const style = {}
      if (fillColor) style.fillColor = fillColor
      const body = withDataAndStyle({ title, format: 'custom' }, style)
      Object.assign(
        body,
        buildPosition({
          x: args.x,
          y: args.y,
          width: args.width,
          height: args.height,
        }),
      )
      return client.createFrame(boardId, body)
    },
  },
  {
    name: 'miro_create_connector',
    title: 'Create connector',
    description: 'Connect two items on a board with a connector.',
    inputSchema: {
      boardId: z.string().min(1),
      startItemId: z.string().min(1),
      endItemId: z.string().min(1),
      color: z.string().optional().describe('Stroke color, e.g. #4262ff'),
      strokeWidth: z.number().optional(),
      shape: z.enum(['straight', 'elbowed', 'curved']).optional(),
    },
    handler: (client, { boardId, startItemId, endItemId, color, strokeWidth, shape }) => {
      const style = {}
      if (color) style.strokeColor = color
      if (strokeWidth) style.strokeWidth = strokeWidth
      return client.createConnector(boardId, {
        startItem: { id: startItemId },
        endItem: { id: endItemId },
        style,
        shape: shape ?? 'curved',
      })
    },
  },
  {
    name: 'miro_update_item',
    title: 'Update item',
    description:
      'Update data, style or position of an existing item. itemType must match the item type (e.g. sticky_note, text, shape, frame).',
    inputSchema: {
      boardId: z.string().min(1),
      itemId: z.string().min(1),
      itemType: z.enum(ITEM_TYPES),
      data: z.record(z.string(), z.unknown()).optional().describe('Payload data object'),
      style: z.record(z.string(), z.unknown()).optional().describe('Style object'),
      position: z.record(z.string(), z.unknown()).optional().describe('Position object'),
    },
    handler: (client, { boardId, itemId, itemType, data, style, position }) => {
      const body = {}
      if (data) body.data = data
      if (style) body.style = style
      if (position) body.position = position
      return client.updateItem(boardId, itemType, itemId, body)
    },
  },
  {
    name: 'miro_delete_item',
    title: 'Delete item',
    description: 'Delete an item from a board. itemType selects the API endpoint.',
    inputSchema: {
      boardId: z.string().min(1),
      itemId: z.string().min(1),
      itemType: z.enum(ITEM_TYPES),
    },
    handler: (client, { boardId, itemId, itemType }) =>
      client.deleteItem(boardId, itemType, itemId),
  },
  {
    name: 'miro_list_members',
    title: 'List board members',
    description: 'List the members of a board.',
    inputSchema: {
      boardId: z.string().min(1),
      limit: z.number().int().min(1).max(50).optional(),
      cursor: z.string().optional(),
    },
    handler: (client, { boardId, ...opts }) => client.listMembers(boardId, opts),
  },
]

/**
 * @typedef {ReturnType<typeof import('./miro-client.js').createMiroClient>} MiroApiClientType
 */
