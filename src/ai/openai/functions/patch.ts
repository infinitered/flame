import type { FnCall } from '../../../types'
import { filesystem } from 'gluegun'
import { uglyDiff } from '../../../utils/uglyDiff'

type PatchInstruction = { insert: string; replace: string }

export const patch: FnCall = {
  name: 'patch',
  description: `Allows replacing the first matching string in a given file. Make sure to match indentation exactly.`,
  parameters: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'The file to patch',
      },
      instructions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            replace: {
              type: 'string',
              description: 'Search for and replace this string with the insert string',
            },
            insert: {
              type: 'string',
              description:
                'This is the string that replaces the `replace` string. If just inserting before/after, make sure to include the replace string where it goes.',
            },
          },
        },
      },
    },
    required: ['file', 'instructions'],
  },
  fn: async (args: { file: string; instructions: PatchInstruction[] }) => {
    const { file, instructions } = args

    const undos: Function[] = []
    const changes: string[] = []

    for (let instruction of instructions) {
      const { insert, replace } = instruction

      const fileContents = await filesystem.readAsync(file, 'utf8')

      if (fileContents === undefined) {
        return { name: 'patch', error: `File '${file}' does not exist.` }
      }

      const { diff, replaceIndex } = uglyDiff(file, fileContents, replace, insert)

      // Then, add the ugly diff to the changes array at the replaceIndex location
      // (yuck but it's so it's in order of line number, which is important for the changes)
      // TODO: better way to sort...or is it just fine?
      changes[replaceIndex] = diff

      // Actually replace the string
      const patchedFileContents = fileContents.replace(replace, insert)

      // Write the file
      await filesystem.writeAsync(file, patchedFileContents)

      // Have an "undo" option which undoes all the patches one at a time
      undos.unshift(async () => filesystem.writeAsync(file, fileContents))
    }

    return {
      name: 'patch',
      content: `Patched ${file}`,
      undo: async () => {
        for (let undo of undos) {
          await undo()
        }
      },
      changes: [...changes.filter((c) => c)].join('\n'),
    }
  },
}
