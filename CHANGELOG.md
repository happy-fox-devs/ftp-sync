# @happy-fox/ftp-sync

## 1.0.0-alpha

### Major Changes

- **Description**

  - The third parameter of the **sync** function has been modified to accept an **options** object of type **FTPSyncOptions**.
    - The **mode** key of type **FTPOptionMode** is now **required** and must be either `push` or `pull`, depending on whether you want to upload or download files.
    - The **operation** key of type **FTPOptionOperation** is **optional** and defaults to `copy`.
      - If not specified or set to `copy`, only file synchronization will be performed.
      - If set to `move`, the synchronization process will include moving the file and deleting the remote file after the operation.

  **Migration from version 0.1.2-alpha to 1.0.0-alpha**

  - Replace the third parameter of the **sync** function with an object of type **FTPSyncOptions**.

  **Usage Example**

  ```ts
  await ftp.sync("local-dir", "remote-dir", {
    mode: "push",
    operation: "move",
  });
  ```
