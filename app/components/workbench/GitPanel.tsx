import React, { useEffect, useState, type ReactNode } from 'react';
import { GitFileStatus, GitStatusMatrix, useGit } from '~/lib/hooks/useGit';
import { PanelHeader } from '~/components/ui/PanelHeader';
import { IconButton } from '~/components/ui/IconButton';
import WithTooltip from '~/components/ui/Tooltip';
import type { FileMap } from '~/lib/stores/files';
import { classNames } from '~/utils/classNames';

interface Props {
  files?: FileMap;
}

interface StatusClassification {
  changed: boolean;
  staged: boolean;
}

export function classifyGitStatus(status: GitFileStatus): StatusClassification {
  switch (status) {
    case GitFileStatus.ABSENT:
      return { changed: false, staged: false };

    case GitFileStatus.UNTRACKED:
      return { changed: true, staged: false };

    case GitFileStatus.ADDED:
      return { changed: false, staged: true };

    case GitFileStatus.ADDED_MODIFIED:
      return { changed: true, staged: true };

    case GitFileStatus.ADDED_DELETED:
      return { changed: true, staged: true };

    case GitFileStatus.UNMODIFIED:
      return { changed: false, staged: false };

    case GitFileStatus.MODIFIED_UNSTAGED:
      return { changed: true, staged: false };

    case GitFileStatus.MODIFIED_STAGED:
      return { changed: false, staged: true };

    case GitFileStatus.MODIFIED_STAGED_UNSTAGED:
      return { changed: true, staged: true };

    case GitFileStatus.DELETED_UNSTAGED:
      return { changed: true, staged: false };

    case GitFileStatus.DELETED_STAGED:
      return { changed: false, staged: true };

    case GitFileStatus.DELETED_MODIFIED:
      return { changed: true, staged: true };

    case GitFileStatus.DELETED_WITH_UNTRACKED:
      return { changed: true, staged: false };

    case GitFileStatus.MODIFIED_THEN_DELETED:
      return { changed: true, staged: true };
    default:
      return { changed: false, staged: false };
  }
}
export default function GitPanel({ files }: Props) {
  const {
    syncChnages,

    getStatus,

    gitMeta,
  } = useGit();

  const [isSyncing, setIsSyncing] = useState(false);
  const [status, setStatus] = useState<[string, 0 | 1, 0 | 2 | 1, 0 | 2 | 1 | 3][]>([]);
  const [filesWithStatus, setFilesWithStatus] = useState<Record<string, GitFileStatus>>({});
  const [selectedFile] = useState<string | undefined>();

  const sync = async () => {
    setIsSyncing(true);

    const fileRecords: Record<string, string> = {};

    if (files) {
      for (const [key, value] of Object.entries(files)) {
        if (value?.type === 'file') {
          fileRecords[key] = value.content;
        }
      }
    }

    await syncChnages(fileRecords);

    const statusMatrix = await getStatus();
    setStatus(statusMatrix);
    setIsSyncing(false);
  };

  useEffect(() => {
    if (status.length > 0) {
      const fileStatuses: Record<string, GitFileStatus> = status.reduce(
        (acc, matrixRow) => {
          const status = GitStatusMatrix.getFileStatus(matrixRow);

          if (status === GitFileStatus.ABSENT || status === GitFileStatus.UNMODIFIED) {
            return acc;
          }

          // Accumulate the file statuses into an object;
          acc[matrixRow[0]] = status;

          return acc;
        },
        {} as Record<string, GitFileStatus>,
      );
      setFilesWithStatus(fileStatuses);
    } else {
      setFilesWithStatus({});
    }
  }, [status]);

  if (!gitMeta) {
    return <div>No Git repo linked</div>;
  }

  return (
    <div className="panel">
      <PanelHeader>
        <span>Source Control</span>
        <div className="flex-1"></div>

        <WithTooltip tooltip="sync" position="left">
          <IconButton icon="i-ph:arrow-clockwise-fill" onClick={() => sync()} disabled={isSyncing} />
        </WithTooltip>
      </PanelHeader>
      <div className="commitbox text-sm flex flex-col gap-2 px-2 mt-2">
        <div className="relative w-full">
          <input
            className="w-full bg-white dark:bg-bolt-elements-background-depth-4 relative px-2 py-1.5 rounded-md focus:outline-none placeholder-bolt-elements-textTertiary text-bolt-elements-textPrimary dark:text-bolt-elements-textPrimary border border-bolt-elements-borderColor"
            type="search"
            placeholder="Message"
            onChange={() => {
              console.log('onChange');
            }}
            aria-label="Commit message"
          />
        </div>
        <a
          href="/"
          className="flex gap-2 items-center bg-bolt-elements-sidebar-buttonBackgroundDefault text-bolt-elements-sidebar-buttonText hover:bg-bolt-elements-sidebar-buttonBackgroundHover rounded-md p-2 transition-theme mb-4"
        >
          <span className="inline-block" />
          Commit
        </a>
      </div>
      <div className="filesStatus">
        <Tree files={filesWithStatus} selectedFile={selectedFile} statusType={'staged'} header="Staged" />
        <Tree files={filesWithStatus} selectedFile={selectedFile} statusType={'changed'} header="Changes" />
      </div>
    </div>
  );
}

const NODE_PADDING_LEFT = 8;

interface ButtonProps {
  depth: number;
  iconClasses: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}

function NodeButton({ depth, iconClasses, onClick, className, children }: ButtonProps) {
  return (
    <button
      className={classNames(
        'flex items-center gap-1.5 w-full pr-2 border-2 border-transparent text-faded py-0.5',
        className,
      )}
      style={{ paddingLeft: `${6 + depth * NODE_PADDING_LEFT}px` }}
      onClick={() => onClick?.()}
    >
      <div className={classNames('scale-120 shrink-0', iconClasses)}></div>
      <div className="truncate w-full text-left">{children}</div>
    </button>
  );
}

interface FolderProps {
  name: string;
  path: string;
  depth: number;
  collapsed?: boolean;
  selected: boolean;
  onClick?: () => void;
}

function Folder({ name, depth, collapsed, onClick, selected }: FolderProps) {
  return (
    <NodeButton
      className={classNames('group', {
        'bg-transparent text-bolt-elements-item-contentDefault hover:text-bolt-elements-item-contentActive hover:bg-bolt-elements-item-backgroundActive':
          !selected,
        'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent': selected,
      })}
      depth={depth}
      iconClasses={classNames({
        'i-ph:caret-right scale-98': !!collapsed,
        'i-ph:caret-down scale-98': !collapsed,
      })}
      onClick={onClick}
    >
      {name}
    </NodeButton>
  );
}

interface FileProps {
  name: string;
  path: string;
  selected: boolean;
  depth: number;
  status: GitFileStatus;
}

function File({ name, depth, selected }: FileProps) {
  return (
    <NodeButton
      className={classNames('group', {
        'bg-transparent hover:bg-bolt-elements-item-backgroundActive text-bolt-elements-item-contentDefault': !selected,
        'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent': selected,
      })}
      depth={depth}
      iconClasses={classNames('i-ph:file-duotone scale-98', {
        'group-hover:text-bolt-elements-item-contentActive': !selected,
      })}

      // onClick={onClick}
    >
      <div
        className={classNames('flex items-center', {
          'group-hover:text-bolt-elements-item-contentActive': !selected,
        })}
      >
        <div className="flex-1 truncate pr-2">{name}</div>
        {/* {unsavedChanges && <span className="i-ph:circle-fill scale-68 shrink-0 text-orange-500" />} */}
      </div>
    </NodeButton>
  );
}

type Node = FileNode | FolderNode;
interface BaseNode {
  depth: number;
  name: string;
  path: string;
}

interface FileNode extends BaseNode {
  kind: 'file';
}

interface FolderNode extends BaseNode {
  kind: 'folder';
}

interface TreeProps {
  files: Record<string, GitFileStatus>;
  selectedFile?: string;
  statusType: 'staged' | 'changed';
  header: string;
}

const Tree = ({ files, selectedFile, statusType, header }: TreeProps) => {
  const [filteredFiles, setFilteredFiles] = useState<Record<string, GitFileStatus>>({});
  const getNodes = (files: Record<string, GitFileStatus>) => {
    return Object.entries(files).reduce(
      (acc, [key]) => {
        const folders = key.split('/');
        folders.pop();

        let root = '';

        for (const folder of folders) {
          const currFolder = [root, folder].join('/');

          if (!acc[currFolder]) {
            acc[currFolder] = {
              kind: 'folder',
              name: folder,
              path: currFolder,
              depth: currFolder.split('/').length - 1,
            };
          }

          root = currFolder;
        }
        acc[key] = {
          kind: 'file',
          name: key.split('/').pop() || '',
          path: key,
          depth: key.split('/').length,
        };

        return acc;
      },
      {} as Record<string, Node>,
    );
  };
  useEffect(() => {
    const newFiles: Record<string, GitFileStatus> = {};
    Object.entries(files).forEach(([key, value]) => {
      const { staged, changed } = classifyGitStatus(value);

      if (statusType === 'staged' && staged) {
        newFiles[key] = value;
      } else if (statusType === 'changed' && changed) {
        newFiles[key] = value;
      }
    });
    setFilteredFiles(newFiles);
  }, [files]);

  if (Object.keys(filteredFiles).length === 0) {
    return <div className="tree"></div>;
  }

  return (
    <div className="tree">
      <Folder selected={`${selectedFile}`.split('/').slice(0, 1).join('/') === '/'} name={header} path="/" depth={0} />
      {Object.entries(getNodes(filteredFiles)).map(([key, value]) => {
        switch (value.kind) {
          case 'file': {
            return (
              <File
                key={key}
                selected={selectedFile === value.path}
                name={value.name}
                path={value.path}
                depth={value.depth}
                status={files[value.path]}
              />
            );
          }
          case 'folder': {
            return (
              <Folder
                key={key}
                selected={`${selectedFile}`.split('/').slice(0, value.depth).join('/') === value.path}
                name={value.name}
                path={value.path}
                depth={value.depth}
              />
            );
          }
          default: {
            return undefined;
          }
        }
      })}
    </div>
  );
};
