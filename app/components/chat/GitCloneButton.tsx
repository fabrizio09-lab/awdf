import ignore from 'ignore';
import { useGit } from '~/lib/hooks/useGit';
import type { Message } from 'ai';
import { detectProjectCommands, createCommandsMessage } from '~/utils/projectCommands';
import { generateId } from '~/utils/fileUtils';
import { useState } from 'react';
import { toast } from 'react-toastify';
import { LoadingOverlay } from '~/components/ui/LoadingOverlay';

const IGNORE_PATTERNS = [
  'node_modules/**',
  '.git/**',
  '.github/**',
  '.vscode/**',
  '**/*.jpg',
  '**/*.jpeg',
  '**/*.png',
  'dist/**',
  'build/**',
  '.next/**',
  'coverage/**',
  '.cache/**',
  '.vscode/**',
  '.idea/**',
  '**/*.log',
  '**/.DS_Store',
  '**/npm-debug.log*',
  '**/yarn-debug.log*',
  '**/yarn-error.log*',
  '**/*lock.json',
  '**/*lock.yaml',
];

const ig = ignore().add(IGNORE_PATTERNS);

interface GitCloneButtonProps {
  className?: string;
  importChat?: (description: string, messages: Message[]) => Promise<void>;
}

export default function GitCloneButton({ importChat }: GitCloneButtonProps) {
  const { ready, gitClone } = useGit();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');

  const onClick = async (_e: any) => {
    if (!ready) {
      return;
    }

    const repoUrl = prompt('Enter the Git url');

    if (repoUrl) {
      setLoading(true);

      try {
        const { workdir, data } = await gitClone(repoUrl, {
          onProgress: (event) => {
            let percent;
            let fsPercent;

            switch (event.phase) {
              case 'counting':
                setProgress(5);
                setProgressText(`Counting objects: ${event.loaded}...`);
                break;
              case 'receiving':
                percent = event.total ? (event.loaded / event.total) * 50 + 10 : 10;
                setProgress(percent);
                setProgressText(`Receiving objects: ${event.loaded}${event.total ? `/${event.total}` : ''}...`);
                break;
              case 'resolving':
                setProgress(65);
                setProgressText('Resolving deltas...');
                break;
              case 'fs_operations':
                fsPercent = event.total ? (event.loaded / event.total) * 25 + 70 : 70;
                setProgress(fsPercent);
                setProgressText(`Processing files: ${event.loaded}/${event.total}`);
                break;
            }
          },
        });

        if (importChat) {
          setProgress(95);
          setProgressText('Processing repository...');

          const filePaths = Object.keys(data).filter((filePath) => !ig.ignores(filePath));
          console.log(filePaths);

          const textDecoder = new TextDecoder('utf-8');

          const fileContents = filePaths
            .map((filePath) => {
              const { data: content, encoding } = data[filePath];
              return {
                path: filePath,
                content:
                  encoding === 'utf8' ? content : content instanceof Uint8Array ? textDecoder.decode(content) : '',
              };
            })
            .filter((f) => f.content);

          setProgressText('Analyzing project structure...');

          const commands = await detectProjectCommands(fileContents);
          const commandsMessage = createCommandsMessage(commands);

          const filesMessage: Message = {
            role: 'assistant',
            content: `Cloning the repo ${repoUrl} into ${workdir}
<boltArtifact id="imported-files" title="Git Cloned Files" type="bundled">
${fileContents
  .map(
    (file) =>
      `<boltAction type="file" filePath="${file.path}">
${file.content}
</boltAction>`,
  )
  .join('\n')}
</boltArtifact>`,
            id: generateId(),
            createdAt: new Date(),
          };

          const messages = [filesMessage];

          if (commandsMessage) {
            messages.push(commandsMessage);
          }

          setProgress(98);
          setProgressText('Finalizing import...');
          await importChat(`Git Project:${repoUrl.split('/').slice(-1)[0]}`, messages);
          setProgress(100);
          setProgressText('Import complete!');
        }
      } catch (error) {
        console.error('Error during import:', error);
        toast.error('Failed to import repository');
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <>
      <button
        onClick={onClick}
        className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-bolt-elements-textSecondary rounded-lg hover:bg-bolt-elements-background-depth-1 transition-colors"
      >
        <div className="i-carbon-logo-github text-lg" />
        Import from GitHub
      </button>
      {loading && (
        <LoadingOverlay
          message="Please wait while we clone the repository..."
          progress={progress}
          progressText={progressText}
        />
      )}
    </>
  );
}
