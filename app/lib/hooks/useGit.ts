import type { WebContainer } from '@webcontainer/api';
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { webcontainer as webcontainerPromise } from '~/lib/webcontainer';
import git, { type GitAuth } from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import Cookies from 'js-cookie';
import { toast } from 'react-toastify';
import FS from '@isomorphic-git/lightning-fs';
import { chatId as chatIdStore, db, getMessages } from '~/lib/persistence';
import { useStore } from '@nanostores/react';
import { createScopedLogger } from '~/utils/logger';

const lookupSavedPassword = (url: string) => {
  const domain = url.split('/')[2];
  const gitCreds = Cookies.get(`git:${domain}`);

  if (!gitCreds) {
    return null;
  }

  try {
    const { username, password } = JSON.parse(gitCreds || '{}');
    return { username, password };
  } catch (error) {
    console.log(`Failed to parse Git Cookie ${error}`);
    return null;
  }
};

const saveGitAuth = (url: string, auth: GitAuth) => {
  const domain = url.split('/')[2];
  Cookies.set(`git:${domain}`, JSON.stringify(auth));
};

const lfsClient = new FS();

type Filename = string;
type HeadStatus = 0 | 1;
type WorkdirStatus = 0 | 1 | 2;
type StageStatus = 0 | 1 | 2 | 3;

type StatusRow = [Filename, HeadStatus, WorkdirStatus, StageStatus];

type StatusMatrix = StatusRow[];

const logger = createScopedLogger('useGit');

export function useGit() {
  const [ready, setReady] = useState(false);
  const [webcontainer, setWebcontainer] = useState<WebContainer>();

  // const [fs, setFs] = useState<PromiseFsClient>();
  const fileData = useRef<Record<string, { data: any; encoding?: string }>>({});
  const chatId = useStore(chatIdStore);
  const [gitMeta, setGitMeta] = useState<{ url: string; branch: string; sourceHash: string } | null>();
  useEffect(() => {
    webcontainerPromise.then((container) => {
      fileData.current = {};
      setWebcontainer(container);

      // setFs(getFs(container, fileData));
      setReady(true);
    });
  }, []);

  const fetchGitMetaData = useCallback(async () => {
    if (!db || !chatId) {
      return null;
    }

    try {
      const chat = await getMessages(db, chatId);
      return chat?.gitMeta || null;
    } catch (error) {
      logger.error(error);
      return null;
    }
  }, [db, chatId]);

  useEffect(() => {
    if (ready) {
      fetchGitMetaData().then((metadata) => {
        setGitMeta(metadata);
      });
    }
  }, [ready, fetchGitMetaData]);

  const onAuth = (url: string) => {
    // let domain=url.split("/")[2]

    let auth = lookupSavedPassword(url);

    if (auth) {
      return auth;
    }

    if (confirm('This repo is password protected. Ready to enter a username & password?')) {
      auth = {
        username: prompt('Enter username'),
        password: prompt('Enter password'),
      };
      return auth;
    } else {
      return { cancel: true };
    }
  };

  const gitClone = useCallback(
    async (url: string) => {
      if (!webcontainer || !ready) {
        throw 'Webcontainer not initialized';
      }

      fileData.current = {};

      const lfs = getLFs(url, fileData);

      await git.clone({
        fs: lfs,
        ref: 'main',
        http,
        dir: webcontainer.workdir,
        url,
        depth: 1,
        singleBranch: true,
        remote: 'origin',
        corsProxy: 'https://cors.isomorphic-git.org',
        onAuth,
        onAuthFailure: (url, _auth) => {
          toast.error(`Error Authenticating with ${url.split('/')[2]}`);
        },
        onAuthSuccess: (url, auth) => {
          saveGitAuth(url, auth);
        },
      });

      const data: Record<string, { data: any; encoding?: string }> = {};

      for (const [key, value] of Object.entries(fileData.current)) {
        const relativePath = pathUtils.relative(webcontainer.workdir, key);
        data[relativePath] = value;
      }

      return { workdir: webcontainer.workdir, data };
    },
    [webcontainer],
  );
  const getStatus = useCallback(
    async (url?: string) => {
      if (!webcontainer || !ready) {
        throw 'Webcontainer not initialized';
      }

      const urlToUse = url || gitMeta?.url;

      if (!urlToUse) {
        throw new Error('No url provided');
      }

      const lfs = getLFs(urlToUse, fileData);
      const status: StatusMatrix = await git.statusMatrix({
        fs: lfs,
        dir: webcontainer.workdir,
      });

      return status;
    },
    [webcontainer, gitMeta],
  );
  const syncChnages = useCallback(
    async (files: { [key: string]: string }, url?: string) => {
      if (!webcontainer || !ready) {
        throw 'Webcontainer not initialized';
      }

      const urlToUse = url || gitMeta?.url;

      if (!urlToUse) {
        throw new Error('No url provided');
      }

      const lfs = getLFs(urlToUse, fileData);
      const items = Object.entries(files);

      for (const [key, value] of items) {
        let path = key;

        if (!path.startsWith(webcontainer.workdir)) {
          path = pathUtils.join(webcontainer.workdir, path);
        }

        await lfs.promises.writeFile(path, value, { encoding: 'utf8' });
      }
    },
    [webcontainer, gitMeta],
  );
  const gitCommit = useCallback(
    async (message: string, url?: string) => {
      if (!webcontainer || !ready) {
        throw 'Webcontainer not initialized';
      }

      const urlToUse = url || gitMeta?.url;

      if (!urlToUse) {
        throw new Error('No url provided');
      }

      const lfs = getLFs(urlToUse, fileData);
      await git.commit({
        fs: lfs,
        dir: webcontainer.workdir,
        message,
        author: {
          name: 'bolt.diy',
          email: 'bolt.diy@noreply.github.com',
        },
      });
    },
    [webcontainer, gitMeta],
  );

  const stageFile = useCallback(
    async (filePath: string, url?: string) => {
      if (!webcontainer || !ready) {
        throw 'Webcontainer not initialized';
      }

      const urlToUse = url || gitMeta?.url;

      if (!urlToUse) {
        throw new Error('No url provided');
      }

      const lfs = getLFs(urlToUse, fileData);
      await git.add({
        fs: lfs,
        dir: webcontainer.workdir,
        filepath: filePath,
      });
    },
    [webcontainer, gitMeta],
  );
  const unstageFile = useCallback(
    async (filePath: string, url?: string) => {
      if (!webcontainer || !ready) {
        throw 'Webcontainer not initialized';
      }

      const urlToUse = url || gitMeta?.url;

      if (!urlToUse) {
        throw new Error('No url provided');
      }

      const lfs = getLFs(urlToUse, fileData);
      await git.remove({
        fs: lfs,
        dir: webcontainer.workdir,
        filepath: filePath,
      });
    },
    [webcontainer, gitMeta],
  );

  const isIgnored = useCallback(
    async (filePath: string, url?: string) => {
      if (!webcontainer || !ready) {
        throw 'Webcontainer not initialized';
      }

      const urlToUse = url || gitMeta?.url;

      if (!urlToUse) {
        throw new Error('No url provided');
      }

      const relativePath = pathUtils.relative(webcontainer.workdir, filePath);
      const lfs = getLFs(urlToUse, fileData);
      const ignored = await git.isIgnored({
        fs: lfs,
        dir: webcontainer.workdir,
        filepath: relativePath,
      });

      return ignored;
    },
    [webcontainer, gitMeta],
  );

  const gitFetch = useCallback(
    async (ref?: string, url?: string) => {
      if (!webcontainer || !ready) {
        throw 'Webcontainer not initialized';
      }

      const urlToUse = url || gitMeta?.url;

      if (!urlToUse) {
        throw new Error('No url provided');
      }

      const lfs = getLFs(urlToUse, fileData);
      await git.fetch({
        fs: lfs,
        dir: webcontainer.workdir,
        remote: 'origin',
        http,
        ref,
        corsProxy: 'https://cors.isomorphic-git.org',
        onAuth,
        onAuthFailure: (url, _auth) => {
          toast.error(`Error Authenticating with ${url.split('/')[2]}`);
        },
      });
    },
    [webcontainer, gitMeta],
  );

  const gitPush = useCallback(
    async (ref: string, url?: string) => {
      if (!webcontainer || !ready) {
        throw 'Webcontainer not initialized';
      }

      const urlToUse = url || gitMeta?.url;

      if (!urlToUse) {
        throw new Error('No url provided');
      }

      const lfs = getLFs(urlToUse, fileData);
      await git.push({
        fs: lfs,
        dir: webcontainer.workdir,
        remote: 'origin',
        http,
        ref,
        remoteRef: ref,
        corsProxy: 'https://cors.isomorphic-git.org',
        onAuth,
        onAuthFailure: (url, _auth) => {
          toast.error(`Error Authenticating with ${url.split('/')[2]}`);
        },
      });
    },
    [webcontainer, gitMeta],
  );

  return {
    ready,
    gitClone,
    gitCommit,
    gitFetch,
    syncChnages,
    gitPush,
    getStatus,
    stageFile,
    unstageFile,
    isIgnored,
    gitMeta,
  };
}

export const getFs = (
  webcontainer: WebContainer,
  record: MutableRefObject<Record<string, { data: any; encoding?: string }>>,
) => ({
  promises: {
    readFile: async (path: string, options: any) => {
      const encoding = options.encoding;
      const relativePath = pathUtils.relative(webcontainer.workdir, path);
      console.log('readFile', relativePath, encoding);

      return await webcontainer.fs.readFile(relativePath, encoding);
    },
    writeFile: async (path: string, data: any, options: any) => {
      const encoding = options.encoding;
      const relativePath = pathUtils.relative(webcontainer.workdir, path);
      console.log('writeFile', { relativePath, data, encoding });

      if (record.current) {
        record.current[relativePath] = { data, encoding };
      }

      return await webcontainer.fs.writeFile(relativePath, data, { ...options, encoding });
    },
    mkdir: async (path: string, options: any) => {
      const relativePath = pathUtils.relative(webcontainer.workdir, path);
      console.log('mkdir', relativePath, options);

      return await webcontainer.fs.mkdir(relativePath, { ...options, recursive: true });
    },
    readdir: async (path: string, options: any) => {
      const relativePath = pathUtils.relative(webcontainer.workdir, path);
      console.log('readdir', relativePath, options);

      return await webcontainer.fs.readdir(relativePath, options);
    },
    rm: async (path: string, options: any) => {
      const relativePath = pathUtils.relative(webcontainer.workdir, path);
      console.log('rm', relativePath, options);

      return await webcontainer.fs.rm(relativePath, { ...(options || {}) });
    },
    rmdir: async (path: string, options: any) => {
      const relativePath = pathUtils.relative(webcontainer.workdir, path);
      console.log('rmdir', relativePath, options);

      return await webcontainer.fs.rm(relativePath, { recursive: true, ...options });
    },

    // Mock implementations for missing functions
    unlink: async (path: string) => {
      // unlink is just removing a single file
      const relativePath = pathUtils.relative(webcontainer.workdir, path);
      return await webcontainer.fs.rm(relativePath, { recursive: false });
    },

    stat: async (path: string) => {
      try {
        const relativePath = pathUtils.relative(webcontainer.workdir, path);
        const resp = await webcontainer.fs.readdir(pathUtils.dirname(relativePath), { withFileTypes: true });
        const name = pathUtils.basename(relativePath);
        const fileInfo = resp.find((x) => x.name == name);

        if (!fileInfo) {
          throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
        }

        return {
          isFile: () => fileInfo.isFile(),
          isDirectory: () => fileInfo.isDirectory(),
          isSymbolicLink: () => false,
          size: 1,
          mode: 0o666, // Default permissions
          mtimeMs: Date.now(),
          uid: 1000,
          gid: 1000,
        };
      } catch (error: any) {
        console.log(error?.message);

        const err = new Error(`ENOENT: no such file or directory, stat '${path}'`) as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        err.errno = -2;
        err.syscall = 'stat';
        err.path = path;
        throw err;
      }
    },

    lstat: async (path: string) => {
      /*
       * For basic usage, lstat can return the same as stat
       * since we're not handling symbolic links
       */
      return await getFs(webcontainer, record).promises.stat(path);
    },

    readlink: async (path: string) => {
      /*
       * Since WebContainer doesn't support symlinks,
       * we'll throw a "not a symbolic link" error
       */
      throw new Error(`EINVAL: invalid argument, readlink '${path}'`);
    },

    symlink: async (target: string, path: string) => {
      /*
       * Since WebContainer doesn't support symlinks,
       * we'll throw a "operation not supported" error
       */
      throw new Error(`EPERM: operation not permitted, symlink '${target}' -> '${path}'`);
    },

    chmod: async (_path: string, _mode: number) => {
      /*
       * WebContainer doesn't support changing permissions,
       * but we can pretend it succeeded for compatibility
       */
      return await Promise.resolve();
    },
  },
});

const getLFs = (url: string, record: MutableRefObject<Record<string, { data: any; encoding?: string }>>) => {
  lfsClient.init(url);
  return {
    promises: {
      readFile: async (path: string, options: any) => {
        const encoding = options.encoding;
        console.log('readFile', path, encoding);

        return await lfsClient.promises.readFile(path, encoding);
      },
      writeFile: async (path: string, data: any, options: any) => {
        const encoding = options.encoding;
        console.log('writeFile', { path, data, encoding });

        if (record.current) {
          record.current[path] = { data, encoding };
        }

        return await lfsClient.promises.writeFile(path, data, options);
      },
      mkdir: async (path: string, options: any) => {
        console.log('mkdir', path, options);

        return await lfsClient.promises.mkdir(path, { ...options });
      },
      readdir: async (path: string, options: any) => {
        console.log('readdir', path, options);

        return await lfsClient.promises.readdir(path, options);
      },
      rmdir: async (path: string, options: any) => {
        return await lfsClient.promises.rmdir(path, options);
      },

      unlink: async (path: string) => {
        return await lfsClient.promises.unlink(path);
      },

      stat: async (path: string) => {
        return await lfsClient.promises.stat(path);
      },

      lstat: async (path: string) => {
        return lfsClient.promises.lstat(path);
      },

      readlink: async (path: string) => {
        return lfsClient.promises.readlink(path);
      },

      symlink: async (target: string, path: string) => {
        return lfsClient.promises.symlink(target, path);
      },

      chmod: async (_path: string, _mode: number) => {
        /*
         * WebContainer doesn't support changing permissions,
         * but we can pretend it succeeded for compatibility
         */
        return await Promise.resolve();
      },
    },
  };
};

const pathUtils = {
  dirname: (path: string) => {
    // Handle empty or just filename cases
    if (!path || !path.includes('/')) {
      return '.';
    }

    // Remove trailing slashes
    path = path.replace(/\/+$/, '');

    // Get directory part
    return path.split('/').slice(0, -1).join('/') || '/';
  },

  basename: (path: string, ext?: string) => {
    // Remove trailing slashes
    path = path.replace(/\/+$/, '');

    // Get the last part of the path
    const base = path.split('/').pop() || '';

    // If extension is provided, remove it from the result
    if (ext && base.endsWith(ext)) {
      return base.slice(0, -ext.length);
    }

    return base;
  },
  relative: (from: string, to: string): string => {
    // Handle empty inputs
    if (!from || !to) {
      return '.';
    }

    // Normalize paths by removing trailing slashes and splitting
    const normalizePathParts = (p: string) => p.replace(/\/+$/, '').split('/').filter(Boolean);

    const fromParts = normalizePathParts(from);
    const toParts = normalizePathParts(to);

    // Find common parts at the start of both paths
    let commonLength = 0;
    const minLength = Math.min(fromParts.length, toParts.length);

    for (let i = 0; i < minLength; i++) {
      if (fromParts[i] !== toParts[i]) {
        break;
      }

      commonLength++;
    }

    // Calculate the number of "../" needed
    const upCount = fromParts.length - commonLength;

    // Get the remaining path parts we need to append
    const remainingPath = toParts.slice(commonLength);

    // Construct the relative path
    const relativeParts = [...Array(upCount).fill('..'), ...remainingPath];

    // Handle empty result case
    return relativeParts.length === 0 ? '.' : relativeParts.join('/');
  },
  join: (...paths: string[]) => {
    // Handle empty paths
    if (paths.length === 0) {
      return '.';
    }

    // Remove trailing slashes
    paths = paths.map((path) => path.replace(/\/+$/, ''));

    // Join the paths
    return paths.join('/');
  },
};

export enum GitFileStatus {
  // File is not present anywhere
  ABSENT = 'ABSENT', // [0,0,0] ''

  // New files
  UNTRACKED = 'UNTRACKED', // [0,2,0] '??'
  ADDED = 'ADDED', // [0,2,2] 'A'
  ADDED_MODIFIED = 'ADDED_MODIFIED', // [0,2,3] 'AM'
  ADDED_DELETED = 'ADDED_DELETED', // [0,0,3] 'AD'

  // Modified files
  UNMODIFIED = 'UNMODIFIED', // [1,1,1] ''
  MODIFIED_UNSTAGED = 'MODIFIED_UNSTAGED', // [1,2,1] 'M'
  MODIFIED_STAGED = 'MODIFIED_STAGED', // [1,2,2] 'M'
  MODIFIED_STAGED_UNSTAGED = 'MODIFIED_STAGED_UNSTAGED', // [1,2,3] 'MM'

  // Deleted files
  DELETED_UNSTAGED = 'DELETED_UNSTAGED', // [1,0,1] 'D'
  DELETED_STAGED = 'DELETED_STAGED', // [1,0,0] 'D'
  DELETED_MODIFIED = 'DELETED_MODIFIED', // [1,2,0] 'D + ??'
  DELETED_WITH_UNTRACKED = 'DELETED_WITH_UNTRACKED', // [1,1,0] 'D + ??'
  MODIFIED_THEN_DELETED = 'MODIFIED_THEN_DELETED', // [1,0,3] 'MD'
}

export class GitStatusMatrix {
  static getFileStatus([_filename, head, workdir, stage]: StatusRow): GitFileStatus {
    // Create a unique key from the status values
    const key = `${head}${workdir}${stage}`;

    switch (key) {
      case '000':
        return GitFileStatus.ABSENT;
      case '020':
        return GitFileStatus.UNTRACKED;
      case '022':
        return GitFileStatus.ADDED;
      case '023':
        return GitFileStatus.ADDED_MODIFIED;
      case '003':
        return GitFileStatus.ADDED_DELETED;
      case '111':
        return GitFileStatus.UNMODIFIED;
      case '121':
        return GitFileStatus.MODIFIED_UNSTAGED;
      case '122':
        return GitFileStatus.MODIFIED_STAGED;
      case '123':
        return GitFileStatus.MODIFIED_STAGED_UNSTAGED;
      case '101':
        return GitFileStatus.DELETED_UNSTAGED;
      case '100':
        return GitFileStatus.DELETED_STAGED;
      case '120':
        return GitFileStatus.DELETED_MODIFIED;
      case '110':
        return GitFileStatus.DELETED_WITH_UNTRACKED;
      case '103':
        return GitFileStatus.MODIFIED_THEN_DELETED;
      default:
        throw new Error(`Invalid status combination: ${key}`);
    }
  }

  // Helper functions for common queries
  static isDeleted(row: StatusRow): boolean {
    const [, , workdir] = row;
    return workdir === 0;
  }

  static hasUnstagedChanges(row: StatusRow): boolean {
    const [, , workdir, stage] = row;
    return workdir !== stage;
  }

  static isModifiedSinceCommit(row: StatusRow): boolean {
    const [, head, workdir] = row;
    return head !== workdir;
  }

  static isUnchangedInNextCommit(row: StatusRow): boolean {
    const [, head, , stage] = row;
    return head === stage;
  }
}
