import { Modal } from 'antd';
import { useState } from 'react';

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  /** Returns whether the credentials were accepted. */
  onLogin: (username: string, password: string) => boolean;
}

/**
 * Asked for only when it is needed — saving, renaming, or removing a spot —
 * rather than up front, so looking at the forecast never requires an account.
 */
export function LoginModal({ open, onClose, onLogin }: LoginModalProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [failed, setFailed] = useState(false);

  const reset = () => {
    setUsername('');
    setPassword('');
    setFailed(false);
  };

  return (
    <Modal
      title="Log in to keep spots"
      open={open}
      onCancel={() => {
        reset();
        onClose();
      }}
      footer={null}
      destroyOnHidden
    >
      <form
        className="login-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (onLogin(username, password)) {
            reset();
            onClose();
          } else {
            setFailed(true);
          }
        }}
      >
        <input
          type="text"
          value={username}
          placeholder="Username"
          aria-label="Username"
          autoFocus
          onChange={(event) => {
            setUsername(event.target.value);
            setFailed(false);
          }}
        />
        <input
          type="password"
          value={password}
          placeholder="Password"
          aria-label="Password"
          onChange={(event) => {
            setPassword(event.target.value);
            setFailed(false);
          }}
        />
        <button type="submit">Log in</button>
        {failed && (
          <span className="login-error" role="alert">
            Wrong username or password.
          </span>
        )}
      </form>
    </Modal>
  );
}
