# @happy-fox/ftp-sync

## 1.0.3-alpha

### Patch Changes

- Remove pnpm only

## 1.0.2-alpha

### Patch Changes

- - **Description**
  - Add ^20.15.1 to engines in package.json

    - The `engines` field in the `package.json` file has been updated to specify that the package is compatible with Node.js version ^20.15.1.
    - This change ensures that users are aware of the required Node.js version for optimal performance and compatibility with the package.

## 1.0.1-alpha

### Patch Changes

- **Description**

  - In the third parameter of the **sync** function an new option has been added called **delFiles** of type **boolean**.
    - The **delFiles** option is **optional** and defaults to `true`.
    - If set to `false`, the synchronization process will not delete the remaining files in the remote directory after the operation.

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
