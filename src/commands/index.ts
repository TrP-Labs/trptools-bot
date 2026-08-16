import type { Command } from '../discord/registry'

import { command as announce } from './announce'
import { command as begin } from './begin'
import { command as complete } from './complete'
import { command as editShift } from './edit-shift'
import { command as ping } from './ping'
import { command as signups } from './signups'
import { command as staffBegin } from './staff-begin'
import { command as status } from './status'

/**
 * Every slash command, listed explicitly.
 *
 * The legacy bot scanned its commands directory at startup with `fs.readdir`,
 * which meant the command list depended on what happened to be on disk and
 * ruled out bundling the bot into a single file. An explicit list is checked
 * by the compiler and works anywhere.
 */
export const commands: Command[] = [
    ping,
    status,
    announce,
    signups,
    staffBegin,
    begin,
    complete,
    editShift
]
